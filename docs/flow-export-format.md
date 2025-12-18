# Flow Export Format (Workbench JSON)

Purpose: provide a stable, versioned JSON format for exporting/importing a workbench “flow” (entry screen + screens + inline keyboards).

The validator lives in `src/lib/validation.ts` (`FlowExportSchema`).

## Top-level shape
```jsonc
{
  "version": "string",
  "entry_screen_id": "string",
  "screens": [ /* Screen */ ]
}
```

Notes:
- `version` is required but currently treated as an opaque string; bump it when you introduce breaking changes to the format.
- `entry_screen_id` must refer to a screen id in `screens`.

## Screen shape
Each screen is validated via `ScreenSchema` in `src/lib/validation.ts` and corresponds to `src/types/telegram.ts`:
```jsonc
{
  "id": "string",
  "name": "string",
  "message_content": "string",
  "keyboard": [ /* KeyboardRow */ ],
  "share_token": "string?",   // optional
  "is_public": true           // required by schema
}
```

### `message_content` encoding
`message_content` can be either:
- Plain text (simple case), or
- A JSON string that encodes message type/parse mode/media (see `serializeMessagePayload` in `src/hooks/chat/useChatState.ts`).

Import logic should accept both forms.

## Inline keyboard
```jsonc
[
  {
    "id": "row-id",
    "buttons": [
      {
        "id": "btn-id",
        "text": "Button text",
        "url": "https://...",            // optional
        "callback_data": "string",       // optional (max 64 bytes UTF-8)
        "linked_screen_id": "screen-id"  // optional (workbench internal navigation)
      }
    ]
  }
]
```

Constraints (enforced by validation):
- `callback_data` is limited to 64 bytes in UTF-8 (`CALLBACK_DATA_MAX_BYTES`).
- Buttons per row and total rows are capped (`MAX_BUTTONS_PER_ROW`, `MAX_KEYBOARD_ROWS`).

## Failure modes & expectations
- Validation should fail fast with user-readable messages (current implementation formats errors with row/button labels).
- Export must not create dangling references:
  - `entry_screen_id` must exist.
  - Any `linked_screen_id` should point to an existing screen id, or be rejected/cleaned before export.

