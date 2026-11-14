import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  fetchKiloAiGatewayFreeModels,
  isKiloAiGatewayModelFree,
  resolveKgwPrefixedId,
  invalidateKiloAiGatewayCache,
  type KiloAiGatewayFreeModel,
} from "../../src/lib/providerModels/kiloAiGatewayDiscovery.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  invalidateKiloAiGatewayCache();
});

function mockFetch(models: any[]): void {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: models }), { status: 200 });
}

function makeModel(overrides: Record<string, unknown> = {}): any {
  return {
    id: "test/model",
    name: "Test Model",
    isFree: true,
    pricing: { prompt: "0", completion: "0" },
    context_length: 100000,
    supported_parameters: ["max_tokens", "temperature", "tools"],
    architecture: {
      input_modalities: ["text"],
      output_modalities: ["text"],
    },
    top_provider: {
      context_length: 100000,
      max_completion_tokens: 4096,
    },
    ...overrides,
  };
}

test("fetchKiloAiGatewayFreeModels: devuelve solo modelos con isFree=true y precios 0/0", async () => {
  mockFetch([
    makeModel({ id: "kilo-auto/free", isFree: true, pricing: { prompt: "0", completion: "0" } }),
    makeModel({
      id: "nvidia/nemotron-3.5-super-vl:free",
      isFree: true,
      pricing: { prompt: "0", completion: "0" },
    }),
    makeModel({
      id: "anthropic/claude-sonnet-4.6",
      isFree: false,
      pricing: { prompt: "0.000003", completion: "0.000015" },
    }),
    makeModel({
      id: "openrouter/auto",
      isFree: false,
      pricing: { prompt: "-1", completion: "-1" },
    }),
    makeModel({ id: "sin-metadatos", isFree: undefined, pricing: undefined }),
  ]);

  const models = await fetchKiloAiGatewayFreeModels();

  assert.equal(models.length, 2);
  const ids = models.map((m) => m.id);
  assert.ok(ids.includes("kilo-auto/free"));
  assert.ok(ids.includes("nvidia/nemotron-3.5-super-vl:free"));
  assert.ok(!ids.includes("anthropic/claude-sonnet-4.6"));
  assert.ok(!ids.includes("openrouter/auto"));
  assert.ok(!ids.includes("sin-metadatos"));
});

test("fetchKiloAiGatewayFreeModels: excluye modelo con isFree=true pero precio > 0", async () => {
  mockFetch([
    makeModel({
      id: "almost-free",
      isFree: true,
      pricing: { prompt: "0.000001", completion: "0" },
    }),
  ]);

  const models = await fetchKiloAiGatewayFreeModels();
  assert.equal(models.length, 0);
});

test("fetchKiloAiGatewayFreeModels: excluye modelo con isFree=false aunque precio sea 0/0", async () => {
  mockFetch([
    makeModel({
      id: "zero-price-not-flagged",
      isFree: false,
      pricing: { prompt: "0", completion: "0" },
    }),
  ]);

  const models = await fetchKiloAiGatewayFreeModels();
  assert.equal(models.length, 0);
});

test("fetchKiloAiGatewayFreeModels: incorpora prefijo kgw/ en prefixedId", async () => {
  mockFetch([
    makeModel({ id: "kilo-auto/free", isFree: true, pricing: { prompt: "0", completion: "0" } }),
  ]);

  const models = await fetchKiloAiGatewayFreeModels();
  assert.equal(models[0].prefixedId, "kgw/kilo-auto/free");
});

test("fetchKiloAiGatewayFreeModels: conserva identificador original en id (sin prefijo)", async () => {
  mockFetch([
    makeModel({
      id: "nvidia/nemotron-3.5-super-vl:free",
      isFree: true,
      pricing: { prompt: "0", completion: "0" },
    }),
  ]);

  const models = await fetchKiloAiGatewayFreeModels();
  assert.equal(models[0].id, "nvidia/nemotron-3.5-super-vl:free");
  assert.equal(models[0].prefixedId, "kgw/nvidia/nemotron-3.5-super-vl:free");
});

test("fetchKiloAiGatewayFreeModels: conserva metadatos relevantes", async () => {
  mockFetch([
    makeModel({
      id: "kilo-auto/free",
      name: "Auto Free",
      isFree: true,
      pricing: { prompt: "0", completion: "0" },
      context_length: 256000,
      supported_parameters: ["max_tokens", "tools", "reasoning"],
      architecture: {
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
      },
      top_provider: {
        context_length: 256000,
        max_completion_tokens: 32768,
      },
    }),
  ]);

  const models = await fetchKiloAiGatewayFreeModels();
  const m = models[0];
  assert.equal(m.name, "Auto Free");
  assert.equal(m.contextLength, 256000);
  assert.equal(m.isFree, true);
  assert.equal(m.pricing.prompt, "0");
  assert.equal(m.pricing.completion, "0");
  assert.ok(m.supportedParameters.includes("tools"));
  assert.ok(m.supportedParameters.includes("reasoning"));
  assert.ok(m.inputModalities.includes("text"));
  assert.ok(m.inputModalities.includes("image"));
  assert.ok(m.outputModalities.includes("text"));
});

test("fetchKiloAiGatewayFreeModels: gestiona error de conexion (fetch lanza)", async () => {
  globalThis.fetch = async () => {
    throw new Error("ECONNREFUSED");
  };

  await assert.rejects(() => fetchKiloAiGatewayFreeModels(), /ECONNREFUSED/);
});

test("fetchKiloAiGatewayFreeModels: gestiona respuesta no-OK (status 500)", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "internal" }), { status: 500 });

  await assert.rejects(() => fetchKiloAiGatewayFreeModels(), /500/);
});

test("fetchKiloAiGatewayFreeModels: gestiona respuesta JSON invalido", async () => {
  globalThis.fetch = async () => new Response("not json", { status: 200 });

  await assert.rejects(() => fetchKiloAiGatewayFreeModels(), /JSON valido/);
});

test("fetchKiloAiGatewayFreeModels: usa cache cuando esta fresco", async () => {
  const calls: string[] = [];
  globalThis.fetch = async () => {
    calls.push("called");
    return new Response(
      JSON.stringify({
        data: [makeModel({ id: "cached-model", isFree: true, pricing: { prompt: "0", completion: "0" } })],
      }),
      { status: 200 }
    );
  };

  const first = await fetchKiloAiGatewayFreeModels();
  const second = await fetchKiloAiGatewayFreeModels();
  assert.equal(calls.length, 1, "fetch no debe llamarse dos veces con cache fresco");
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
});

test("isKiloAiGatewayModelFree: true para modelo gratuito", async () => {
  mockFetch([
    makeModel({ id: "kilo-auto/free", isFree: true, pricing: { prompt: "0", completion: "0" } }),
  ]);

  assert.equal(await isKiloAiGatewayModelFree("kilo-auto/free"), true);
});

test("isKiloAiGatewayModelFree: false para modelo de pago", async () => {
  mockFetch([
    makeModel({
      id: "anthropic/claude-sonnet-4.6",
      isFree: false,
      pricing: { prompt: "0.000003", completion: "0.000015" },
    }),
  ]);

  assert.equal(await isKiloAiGatewayModelFree("anthropic/claude-sonnet-4.6"), false);
});

test("isKiloAiGatewayModelFree: false para modelo desconocido", async () => {
  mockFetch([]);

  assert.equal(await isKiloAiGatewayModelFree("no-existe/modelo"), false);
});

test("resolveKgwPrefixedId: devuelve kgw/ + id para modelo gratuito", async () => {
  mockFetch([
    makeModel({ id: "kilo-auto/free", isFree: true, pricing: { prompt: "0", completion: "0" } }),
  ]);

  const result = await resolveKgwPrefixedId("kilo-auto/free");
  assert.equal(result, "kgw/kilo-auto/free");
});

test("resolveKgwPrefixedId: devuelve null para modelo de pago", async () => {
  mockFetch([
    makeModel({
      id: "anthropic/claude-sonnet-4.6",
      isFree: false,
      pricing: { prompt: "0.000003", completion: "0.000015" },
    }),
  ]);

  const result = await resolveKgwPrefixedId("anthropic/claude-sonnet-4.6");
  assert.equal(result, null);
});

test("resolveKgwPrefixedId: devuelve null para modelo desconocido", async () => {
  mockFetch([]);

  const result = await resolveKgwPrefixedId("no-existe/modelo");
  assert.equal(result, null);
});

test("fetchKiloAiGatewayFreeModels: ordena resultados por id de forma estable", async () => {
  mockFetch([
    makeModel({ id: "z-model", isFree: true, pricing: { prompt: "0", completion: "0" } }),
    makeModel({ id: "a-model", isFree: true, pricing: { prompt: "0", completion: "0" } }),
    makeModel({ id: "m-model", isFree: true, pricing: { prompt: "0", completion: "0" } }),
  ]);

  const models = await fetchKiloAiGatewayFreeModels();
  const ids = models.map((m) => m.id);
  assert.deepEqual(ids, ["a-model", "m-model", "z-model"]);
});
