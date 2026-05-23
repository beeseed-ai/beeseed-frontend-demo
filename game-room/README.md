# Game Room frontend template

`game-room` is a 2.5D game-style BeeSeed App frontend template. It maps channels to floating rooms, Agents to room characters, and built-in Worker tools to room props.

## Runtime mapping

- `current_time` -> clock
- `http_request`, `request`, `fetch` -> computer
- `task_management`, `todo_list`, `todo` -> whiteboard
- `storage_*`, file/cloud tools -> file cabinet
- `knowledge_search`, knowledge/search tools -> reference table
- Unknown tools -> console

The template does not add backend state. It consumes existing SDK channel, member, Agent loop, and tool-call state, then maps those events into local animation commands.

## Local development

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 5194
```

Preview mode:

```text
http://127.0.0.1:5194/?game-room-preview
```

Preview mode runs a local loop through several tool actions so movement, prop highlights, multi-Agent display, keyboard switching, and swipe switching can be inspected without a Worker session.

Asset review mode:

```text
http://127.0.0.1:5194/?asset-review
```

Asset review mode loops the Assistant runtime actions and the current review candidate sprite sheets across all 8 directions. The walk review candidate is generated with a fixed viewport crop and per-direction adaptive loop detection so different source videos can use different cycle ranges.

Cycle review mode:

```text
http://127.0.0.1:5194/?cycle-review
```

Cycle review mode shows the source videos directly, lets a reviewer choose the start and end frame for each direction, previews the loop, and copies the selected cycle-boundary JSON.

## Build and publish artifact

Build the source template:

```bash
npm run build
```

Publish artifact into the local templates tree:

```bash
rm -rf ../../../templates/frontends/game-room
mkdir -p ../../../templates/frontends/game-room
cp -a dist/. ../../../templates/frontends/game-room/
```

The App template entry is `templates/apps/game-room-agent-room.json`.
