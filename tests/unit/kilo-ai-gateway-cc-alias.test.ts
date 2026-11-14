import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { appendCcDiscoveryAliases, isCcDiscoveryAlias } from "../../open-sse/utils/ccDiscoveryAliases.ts";
import { stripCcDiscoveryAlias } from "../../open-sse/handlers/chatCore/ccDiscoveryAliasStrip.ts";

function makeKgwEntry(id: string): Record<string, unknown> {
  return {
    id: `kgw/${id}`,
    object: "model",
    owned_by: "kilo-ai-gateway",
    root: id,
    context_length: 100000,
    isFree: true,
    pricing: { prompt: "0", completion: "0" },
  };
}

function makeClaudeEntry(id: string): Record<string, unknown> {
  return {
    id: `claude/${id}`,
    object: "model",
    owned_by: "claude",
    root: id,
  };
}

function stripDeps(opts: {
  isClaudeProviderModel?: (rest: string) => boolean;
  isKnownProviderPrefix?: (prefix: string) => boolean;
  hasCombo?: (name: string) => boolean;
  aliasEnabledFor?: (rest: string) => boolean;
}) {
  return {
    isClaudeProviderModel: opts.isClaudeProviderModel ?? (() => false),
    isKnownProviderPrefix: opts.isKnownProviderPrefix ?? ((prefix: string) => prefix === "kgw"),
    hasCombo: opts.hasCombo ?? (() => false),
    aliasEnabledFor: opts.aliasEnabledFor ?? (() => true),
  };
}

test("appendCcDiscoveryAliases: genera claude/kgw/<id> para entrada kgw/<id> cuando gate esta on", () => {
  const models = [makeKgwEntry("kilo-auto/free")];
  const isEnabled = (entry: Record<string, unknown>) => {
    const id = entry.id as string;
    const slash = id.indexOf("/");
    const providerId = slash > 0 ? id.slice(0, slash) : id;
    return providerId === "kgw";
  };
  const result = appendCcDiscoveryAliases(models, isEnabled);
  const alias = result.find((m) => m.id === "claude/kgw/kilo-auto/free");
  assert.ok(alias, "deberia generarse el alias claude/kgw/kilo-auto/free");
  assert.equal((alias as Record<string, unknown>).root, "free");
  assert.ok(isCcDiscoveryAlias(alias as Record<string, unknown>));
});

test("appendCcDiscoveryAliases: no genera alias claude/kgw/ cuando gate rechaza", () => {
  const models = [makeKgwEntry("kilo-auto/free")];
  const isEnabled = () => false;
  const result = appendCcDiscoveryAliases(models, isEnabled);
  const alias = result.find((m) => m.id === "claude/kgw/kilo-auto/free");
  assert.equal(alias, undefined);
  assert.equal(result.length, 1);
});

test("appendCcDiscoveryAliases: no duplica ids que ya empiezan con claude/", () => {
  const models = [makeClaudeEntry("claude-3-sonnet")];
  const isEnabled = () => true;
  const result = appendCcDiscoveryAliases(models, isEnabled);
  const doublePrefixed = result.filter((m) => (m.id as string).startsWith("claude/claude/"));
  assert.equal(doublePrefixed.length, 0);
});

test("stripCcDiscoveryAlias: resuelve claude/kgw/kilo-auto/free -> kgw/kilo-auto/free", () => {
  const deps = stripDeps({
    isKnownProviderPrefix: (prefix) => prefix === "kgw",
    aliasEnabledFor: () => true,
  });
  const result = stripCcDiscoveryAlias("claude/kgw/kilo-auto/free", deps);
  assert.equal(result.stripped, true);
  assert.equal(result.model, "kgw/kilo-auto/free");
});

test("stripCcDiscoveryAlias: no toca id sin prefijo claude/", () => {
  const deps = stripDeps({});
  const result = stripCcDiscoveryAlias("kgw/kilo-auto/free", deps);
  assert.equal(result.stripped, false);
  assert.equal(result.model, "kgw/kilo-auto/free");
});

test("stripCcDiscoveryAlias: rechaza claude/kgw/ cuando aliasEnabledFor devuelve false", () => {
  const deps = stripDeps({
    isKnownProviderPrefix: (prefix) => prefix === "kgw",
    aliasEnabledFor: () => false,
  });
  const result = stripCcDiscoveryAlias("claude/kgw/kilo-auto/free", deps);
  assert.equal(result.stripped, false);
  assert.equal(result.model, "claude/kgw/kilo-auto/free");
});

test("stripCcDiscoveryAlias: rechaza modelo claude legítimo sin tocar", () => {
  const deps = stripDeps({
    isKnownProviderPrefix: (prefix) => prefix === "kgw",
    aliasEnabledFor: () => true,
    isClaudeProviderModel: (rest) => rest === "claude-3-sonnet",
  });
  const result = stripCcDiscoveryAlias("claude/claude-3-sonnet", deps);
  assert.equal(result.stripped, false);
  assert.equal(result.model, "claude/claude-3-sonnet");
});
