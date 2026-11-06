# Protocol changes

Append one line per change. Only OPTIONAL additions are allowed during the first build session.

- 2026-11-06 lead: initial contract (index.ts, reducer.ts, client.ts, fixtures.ts).
- 2026-11-06 lead (phase 2): Bot.persona/model/tools/builtin; ModelRef, NativeToolGroup, ProviderCatalogEntry, ModelInfo, ModelProviderConfig, ModelSettings; methods bot.add(+persona,model,tools,skills,tagline), bot.update, bot.remove, model.catalog/providers/providerUpsert/providerDelete/list/test/settingsSet; pushes bot.removed, models.changed; Snapshot.modelSettings; HubModel.modelSettings. Daemon: StartSessionOpts.bot, ModelService.
- 2026-11-06 thinking: Entry kind `thinking` {botId,text,streaming?,durationMs?} (model reasoning, shown folded); `entry.delta` also appends to `thinking` entries (reducer). Additive: older clients skip the unknown kind. Daemon: DriverEvent `thinking_delta` / `thinking_done`.
