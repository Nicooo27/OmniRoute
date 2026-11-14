import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateKgwRouting,
  evaluateKgwRoutingSync,
  invalidateKgwRoutingGuardCache,
} from "../../src/lib/providerModels/kiloAiGatewayRoutingGuard.ts";
import {
  fetchKiloAiGatewayFreeModels,
  invalidateKiloAiGatewayCache,
} from "../../src/lib/providerModels/kiloAiGatewayDiscovery.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  invalidateKiloAiGatewayCache();
  invalidateKgwRoutingGuardCache();
});

function mockFetch(models: any[]): void {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: models }), { status: 200 });
}

function makeFreeModel(id: string): any {
  return {
    id,
    name: `Free ${id}`,
    isFree: true,
    pricing: { prompt: "0", completion: "0" },
    context_length: 100000,
    supported_parameters: ["max_tokens", "tools"],
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    top_provider: { context_length: 100000, max_completion_tokens: 4096 },
  };
}

function makePaidModel(id: string): any {
  return {
    id,
    name: `Paid ${id}`,
    isFree: false,
    pricing: { prompt: "0.000003", completion: "0.000015" },
    context_length: 100000,
    supported_parameters: ["max_tokens", "tools"],
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    top_provider: { context_length: 100000, max_completion_tokens: 4096 },
  };
}

test("evaluateKgwRouting: permite kgw/ con modelo gratuito confirmado", async () => {
  mockFetch([makeFreeModel("kilo-auto/free")]);

  const decision = await evaluateKgwRouting("kgw/kilo-auto/free");

  assert.equal(decision.allowed, true);
  assert.equal(decision.prefixedModelId, "kgw/kilo-auto/free");
  assert.equal(decision.reason, "free-model");
  assert.ok(decision.message.includes("gratuito"));
});

test("evaluateKgwRouting: deniega kgw/ con modelo de pago", async () => {
  mockFetch([makePaidModel("anthropic/claude-sonnet-4.6")]);

  const decision = await evaluateKgwRouting("kgw/anthropic/claude-sonnet-4.6");

  assert.equal(decision.allowed, false);
  assert.equal(decision.prefixedModelId, null);
  assert.equal(decision.reason, "unknown-model");
  assert.ok(decision.message.includes("bloqueados"));
});

test("evaluateKgwRouting: deniega kgw/ con modelo desconocido (no en catalogo)", async () => {
  mockFetch([makeFreeModel("kilo-auto/free")]);

  const decision = await evaluateKgwRouting("kgw/no-existe/modelo");

  assert.equal(decision.allowed, false);
  assert.equal(decision.prefixedModelId, null);
  assert.equal(decision.reason, "unknown-model");
});

test("evaluateKgwRouting: permite modelos sin prefijo kgw/ (no gestionados por esta guarda)", async () => {
  mockFetch([]);

  const decision = await evaluateKgwRouting("kc/some-model");
  assert.equal(decision.allowed, true);
  assert.equal(decision.prefixedModelId, "kc/some-model");

  const decision2 = await evaluateKgwRouting("anthropic/claude-3");
  assert.equal(decision2.allowed, true);
  assert.equal(decision2.prefixedModelId, "anthropic/claude-3");
});

test("evaluateKgwRouting: deniega kgw/ con identificador vacio despues del prefijo", async () => {
  mockFetch([]);

  const decision = await evaluateKgwRouting("kgw/");
  assert.equal(decision.allowed, false);
  assert.equal(decision.prefixedModelId, null);
  assert.equal(decision.reason, "unknown-model");

  // "kgw" sin barra final no tiene el prefijo kgw/ y no es gestionado por esta guarda.
  const decision2 = await evaluateKgwRouting("kgw");
  assert.equal(decision2.allowed, true);
});

test("evaluateKgwRouting: deniega cuando el catalogo falla (error de red)", async () => {
  globalThis.fetch = async () => {
    throw new Error("ECONNREFUSED");
  };

  const decision = await evaluateKgwRouting("kgw/kilo-auto/free");

  assert.equal(decision.allowed, false);
  assert.equal(decision.prefixedModelId, null);
  assert.equal(decision.reason, "catalog-error");
  assert.ok(decision.message.includes("bloquea"));
});

test("evaluateKgwRoutingSync: permite modelo en cache", async () => {
  mockFetch([makeFreeModel("kilo-auto/free")]);
  await evaluateKgwRouting("kgw/kilo-auto/free"); // poblar cache

  const decision = evaluateKgwRoutingSync("kgw/kilo-auto/free");
  assert.equal(decision.allowed, true);
  assert.equal(decision.prefixedModelId, "kgw/kilo-auto/free");
});

test("evaluateKgwRoutingSync: deniega modelo no en cache", async () => {
  mockFetch([makeFreeModel("kilo-auto/free")]);
  // No llamar a evaluateKgwRouting primero, para que el cache este vacio

  const decision = evaluateKgwRoutingSync("kgw/kilo-auto/free");
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "catalog-error");
});

test("evaluateKgwRoutingSync: permite modelos sin prefijo kgw/", async () => {
  const decision = evaluateKgwRoutingSync("kc/some-model");
  assert.equal(decision.allowed, true);
});

test("evaluateKgwRouting: conserva identificador con barras internas (nvidia/nemotron-3.5-super-vl:free)", async () => {
  mockFetch([makeFreeModel("nvidia/nemotron-3.5-super-vl:free")]);

  const decision = await evaluateKgwRouting("kgw/nvidia/nemotron-3.5-super-vl:free");

  assert.equal(decision.allowed, true);
  assert.equal(decision.prefixedModelId, "kgw/nvidia/nemotron-3.5-super-vl:free");
});

test("evaluateKgwRouting: excluye modelo humano/ampersand (isFree=false aunque precio 0/0)", async () => {
  mockFetch([
    {
      id: "humansand/ampersand-v0.1",
      name: "Ampersand v0.1",
      isFree: false,
      pricing: { prompt: 0, completion: 0 },
      context_length: 1000000,
      supported_parameters: ["max_tokens", "tools"],
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      top_provider: { context_length: 1000000, max_completion_tokens: 4096 },
    },
  ]);

  const decision = await evaluateKgwRouting("kgw/humansand/ampersand-v0.1");

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "unknown-model");
});
