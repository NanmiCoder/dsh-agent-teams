# plugin-write Reference Index

Read only the file needed for the task:

| File | When to read it |
|---|---|
| [naming-conventions.md](naming-conventions.md) | Check official naming compatibility and optional community collision recommendations |
| [registry-check.md](registry-check.md) | Query reviewed central registrations after offline naming validation and prepare a contextual registration |
| [version-adaptation.md](version-adaptation.md) | Adapt an existing plugin to a new Harness version |
| [tool-plugin.md](tool-plugin.md) | Write a model-callable tool |
| [llm-adapter-plugin.md](llm-adapter-plugin.md) | Connect a model provider |
| [hook-plugin.md](hook-plugin.md) | Write event and policy hooks |
| [service-plugin.md](service-plugin.md) | Expose a service to other plugins |
| [config-plugin.md](config-plugin.md) | Define configurable plugin behavior |

For a new external plugin, read `naming-conventions.md`, then `registry-check.md` when a central lookup
or registration is needed, plus the matching form reference. For a version adaptation, read
`version-adaptation.md` first and then the matching form reference.
