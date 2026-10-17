# Regex Rule Scope

A regex rule can be applied in several places. The regex editor splits the choice into two groups, and options from either group can be combined freely on one rule.

## Affects

**Affects** decides which content a rule processes.

- **User Input**, **AI Output**, **Slash Commands**, **World Info**, and **Reasoning** narrow a rule to messages of that kind. A rule applies only to messages whose role matches a ticked placement; with none ticked, the rule is stored and never runs.
- **Plugin Messages** makes a rule process plugin request traffic: the text going into a plugin request — the chat floor text, plugin-composed messages, and world info entries — and the assistant text the request returns.
- **Min Depth** and **Max Depth** filter the messages a rule processes by their position in the chat.

## Other Options → Ephemerality

**Ephemerality** decides whether a rule acts on a single view instead of rewriting the chat file.

- **Alter Chat Display** — the rule rewrites what the Chat UI shows.
- **Alter Outgoing Prompt** — the rule rewrites the prompt the main chat sends.
- With neither ticked, the rule rewrites the chat file itself when messages are edited or saved.

## Notes

- To clear custom CoT tags from message text, leave the Ephemerality options unticked: the rule rewrites the stored messages once, and the chat display, the prompt, and plugin requests all read the cleaned text.
- Ticking both **Alter Chat Display** and **Alter Outgoing Prompt** for custom CoT tags only adds overhead.
- To keep custom CoT tags in a collapsible section instead of deleting the text, use **Advanced Formatting** → **Reasoning Formatting**.

## Related Pages

- [Plugin-Registered Regex](/features/regex-provider) — Registering regex rules from plugin code
- [Extension API Reference — Chat and State](/development/extension-api/chat-and-state) — Regex rules from a plugin's perspective
