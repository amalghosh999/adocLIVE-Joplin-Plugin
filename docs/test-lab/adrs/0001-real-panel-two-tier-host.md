# ADR 0001: Run the real panel with a two-tier host

Status: accepted

The lab builds `src/panel.ts` with the production loaders and copies production CSS/fonts. It does not recreate editor behavior. Fast tests use an in-memory host in the controller; production uses Joplin adapters. Both enter the same validated RPC routing boundary. An extracted-JPL smoke runs the packaged artifacts. This combination provides speed without representing the fake host as complete desktop Joplin coverage.
