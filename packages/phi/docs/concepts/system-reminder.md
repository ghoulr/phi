# System Reminder

Per-turn metadata is persisted as a synthetic part on the current user message.
It is sent to the model as part of that user turn and stays in session history.

## What it carries

Background the agent needs but the user did not type.

## Shape

~~~text
<system-reminder>
current_message:
  message_id: 181
  from:
    id: 100
    first_name: Zhou
    last_name: Rui
reply_to_message:
  message_id: 178
  from:
    id: 101
    first_name: Phi
  text:
  ```text
Here are the two test files:
  ```
quote:
  text:
  ```text
two test files
  ```
  position: 0
</system-reminder>
~~~

## Rules

- Built by phi and attached to the current user message.
- The user message body is sent separately.
- Carries background, not delivery policy.
- Keep Telegram field names when possible.
- Keep the outer `<system-reminder>` markers stable.
- Keep the inner content simple markdown.
- Wrap text-like metadata such as `text` or `caption` in fenced code blocks.
- Remove null, undefined, and empty fields.

System reminder carries transport background, not delivery policy.
The agent decides reply behavior based on the reminder content.
