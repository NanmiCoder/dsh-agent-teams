#!/usr/bin/env python3
"""Read exported, unseeded session.v3 logs; emit counts/timings, not prompt text.

Usage: python3 analyze-session.py /path/to/export > metrics.json
Step latency includes request preparation and transport; it is not GPU latency.
Overlapping tools and parallel sessions must not be summed as wall-clock time.
"""
import collections
import datetime
import hashlib
import json
import pathlib
import statistics
import sys
from zoneinfo import ZoneInfo

root = pathlib.Path(sys.argv[1]).resolve()
paths = [root / 'session.v3.jsonl', *sorted(root.glob('subagents/*/session.v3.jsonl'))]
zone = ZoneInfo('Asia/Shanghai')
tools = collections.defaultdict(list)
windows = collections.defaultdict(list)
sessions = []
task_creations = []
catalog = []


def time_label(value):
    return datetime.datetime.fromtimestamp(value / 1000, zone).isoformat(timespec='milliseconds')


def summary(values):
    return {'count': len(values), 'sum_seconds': round(sum(values), 3),
            'median_seconds': round(statistics.median(values), 3) if values else 0,
            'max_seconds': round(max(values), 3) if values else 0}


for path in paths:
    raw = path.read_bytes()
    rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
    header = rows[0]
    if header.get('isSeeded'):
        raise ValueError('This audit requires unseeded exports; inherited history must be separated first')
    descriptor = next((row['data'] for row in rows if row['type'] == 'subagent/descriptor'), {})
    starts, calls = {}, {}
    queue = collections.defaultdict(list)
    queue_max = collections.Counter()
    durations, first_stream, tool_times, input_sizes = [], [], [], []
    configs = []
    errors = []
    usage = collections.Counter()
    assignments = 0
    consumed_ids = set()
    for row in rows:
        kind, data, at = row['type'], row.get('data', {}), row.get('time', 0)
        if kind == 'step/start':
            starts[data['turn'], data['step']] = at
        elif kind == 'assistant/message':
            start = starts[data['turn'], data['step']]
            duration = (at - start) / 1000
            first = min((part.get('time', part.get('time0', at)) for part in data.get('stream', [])), default=at)
            durations.append(duration)
            first_stream.append((first - start) / 1000)
            usage.update({key: value for key, value in data.get('usage', {}).items() if isinstance(value, (int, float))})
            input_sizes.append(data.get('usage', {}).get('inputTokens', 0) + data.get('usage', {}).get('cacheReadTokens', 0))
            moment = datetime.datetime.fromtimestamp(start / 1000, zone)
            window = moment.replace(minute=moment.minute // 5 * 5, second=0, microsecond=0).isoformat()
            windows[window].append((duration, (first - start) / 1000))
        elif kind == 'tool/call':
            calls[data['callId']] = (at, data['name'], row['seq'])
        elif kind == 'tool/result':
            start, name, call_seq = calls[data['message']['source']['callId']]
            duration = (at - start) / 1000
            tool_times.append(duration)
            tools[name].append(duration)
            failed = any(block.get('isError') for block in data['message']['content'])
            if failed:
                errors.append({'tool': name, 'call_seq': call_seq, 'result_seq': row['seq'], 'time': time_label(at)})
            if name == 'agent_teams_create_task':
                task_creations.append({'call_seq': call_seq, 'time': time_label(at), 'error': failed, 'seconds': duration})
        elif kind == 'agent/inbox/spliced':
            target = data['target']
            added = [{'id': value['id'], 'enqueued_at': at} for value in data.get('inserted', [])]
            start = data['start']
            queue[target][start:start + data.get('removedCount', 0)] = added
            queue_max[target] = max(queue_max[target], len(queue[target]))
        elif kind == 'user/message':
            consumed_ids.add(data.get('id'))
            assignments += sum(block.get('type') == 'text' and block.get('text', '').startswith(
                'AgentTeams automatic task assignment from the shared task list.') for block in data.get('content', []))
        elif kind == 'request/header':
            config = data['header']['config']
            configs.append({key: config[key] for key in ['provider', 'model', 'reasoningEffort', 'maxTokens'] if key in config})
        elif kind == 'subagent/catalog':
            catalog.append({'time': time_label(at), 'parent': header['id'],
                            'child': data['childId'], 'label': data.get('label')})
    timestamps = [row['time'] for row in rows if 'time' in row]
    pending = [{'target': target, 'id': item['id'], 'enqueued_at': time_label(item['enqueued_at']),
                'age_at_last_event_seconds': round((max(timestamps) - item['enqueued_at']) / 1000, 3),
                'consumed_as_user_message': item['id'] in consumed_ids}
               for target, items in queue.items() for item in items]
    sessions.append({
        'file': str(path.relative_to(root)), 'sha256': hashlib.sha256(raw).hexdigest(),
        'id': header['id'], 'parent': header.get('parentSession'),
        'label': descriptor.get('label', 'captain'), 'delegation_depth': header.get('delegationDepth'),
        'first_event': time_label(min(timestamps)), 'last_event': time_label(max(timestamps)),
        'observed_span_seconds': round((max(timestamps) - min(timestamps)) / 1000, 3),
        'configs': configs, 'event_counts': dict(collections.Counter(row['type'] for row in rows)),
        'step_to_assistant': summary(durations), 'step_to_first_stream_event': summary(first_stream),
        'tool_duration': summary(tool_times), 'max_input_tokens_including_cache': max(input_sizes, default=0),
        'usage_sum': dict(usage), 'queue_max': dict(queue_max), 'pending_at_end': pending,
        'automatic_assignment_prompts_consumed': assignments, 'tool_errors': errors,
    })

print(json.dumps({
    'timezone': str(zone),
    'measurement': 'step/start to assistant/message includes request preparation, transport and generation; overlapping durations are not wall time',
    'sessions': sessions,
    'tool_timings': {name: summary(values) for name, values in sorted(tools.items())},
    'five_minute_windows_by_step_start': {
        window: {'steps': len(values), 'median_step_seconds': round(statistics.median(pair[0] for pair in values), 3),
                 'median_first_stream_seconds': round(statistics.median(pair[1] for pair in values), 3)}
        for window, values in sorted(windows.items())},
    'task_creation_results': task_creations, 'child_catalog_events': catalog,
}, ensure_ascii=False, indent=2))
