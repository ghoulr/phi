# System Reminder

Per-turn metadata persisted as a synthetic part on the current user message. It is sent to the model as part of that user turn and stays in session history.

## What it carries

Message metadata the agent needs but the user didn't type.

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

- Built by phi and attached to the current user message as a synthetic part
- The user message body is sent separately; `system_reminder` only carries metadata
- Keep Telegram field names when possible
- Keep the outer `<system-reminder>` markers stable
- The inner content is simple markdown
- Text-like metadata such as `text` or `caption` is wrapped in fenced code blocks
- Remove null, undefined, and empty fields
