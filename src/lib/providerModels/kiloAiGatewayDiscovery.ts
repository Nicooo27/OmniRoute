/**
 * kiloAiGatewayDiscovery.ts — Descubrimiento de modelos gratuitos de Kilo AI Gateway.
 *
 * Consulta GET https://ai-gateway.kilo.ai/api/v1/models y filtra exclusivamente
 * los modelos que el catalogo identifique inequívocamente como gratuitos:
 *   - isFree === true, Y
 *   - pricing.prompt === "0" (o 0), Y
 *   - pricing.completion === "0" (o 0)
 *
 * Si faltan los metadatos para demostrar que un modelo es gratuito, se excluye.
 * No se utilizan listas hardcodeadas: la decision se basa unicamente en los
 * metadatos reales del catalogo.
 *
 * Los resultados se cachean en memoria siguiendo una politica simple de TTL.
 */

const KILO_AI_GATEWAY_BASE_URL = "https://ai-gateway.kilo.ai/api/v1";
const KILO_AI_GATEWAY_MODELS_URL = `${KILO_AI_GATEWAY_BASE_URL}/models`;
const KGW_PREFIX = "kgw/";

// TTL del cache: 5 minutos (equilibra frescura del catalogo y peticiones de red).
const CACHE_TTL_MS = 5 * 60 * 1000;

interface KiloAiGatewayModelRaw {
  id: string;
  name?: string;
  created?: number;
  description?: string;
  context_length?: number;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
    [key: string]: unknown;
  };
  isFree?: boolean;
  supported_parameters?: string[];
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    [key: string]: unknown;
  };
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface KiloAiGatewayCatalogResponse {
  data?: KiloAiGatewayModelRaw[];
  [key: string]: unknown;
}

interface KiloAiGatewayFreeModel {
  id: string; // Identificador original sin prefijo (ej. "kilo-auto/free")
  prefixedId: string; // Identificador con prefijo (ej. "kgw/kilo-auto/free")
  name: string;
  contextLength: number | null;
  pricing: {
    prompt: string | number | null;
    completion: string | number | null;
  };
  isFree: boolean;
  supportedParameters: string[];
  inputModalities: string[];
  outputModalities: string[];
}

/** Entrada del cache con timestamp de carga. */
type CacheEntry = {
  models: KiloAiGatewayFreeModel[];
  fetchedAt: number;
};

let _cache: CacheEntry | null = null;

/**
 * Normaliza un valor de precio del catalogo a string para comparacion segura.
 * El catalogo devuelve precios como string ("0", "-1") o como numero.
 */
function normalizePrice(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return String(value);
}

/**
 * Determina si un modelo del catalogo es gratuito con certeza.
 *
 * Un modelo es gratuito SOLO cuando:
 *   - isFree === true, Y
 *   - pricing.prompt === "0" (o 0), Y
 *   - pricing.completion === "0" (o 0)
 *
 * Cualquier otro caso (isFree false, pricing "-1", precios > 0, campos
 * ausentes) se trata como NO gratuito y se excluye del enrutamiento anonimo.
 */
function isModelFreeByMetadata(model: KiloAiGatewayModelRaw): boolean {
  if (model.isFree !== true) return false;

  const pricing = model.pricing;
  if (!pricing || typeof pricing !== "object") return false;

  const prompt = normalizePrice(pricing.prompt);
  const completion = normalizePrice(pricing.completion);

  // Ambos precios deben ser exactamente "0" o 0.
  if (prompt !== "0" && prompt !== 0) return false;
  if (completion !== "0" && completion !== 0) return false;

  return true;
}

/**
 * Extrae un modelo gratuito del catalogo crudo y lo mapea al formato de salida.
 */
function mapFreeModel(raw: KiloAiGatewayModelRaw): KiloAiGatewayFreeModel | null {
  if (!isModelFreeByMetadata(raw)) return null;

  const pricing = raw.pricing || {};
  const arch = raw.architecture || {};

  return {
    id: raw.id,
    prefixedId: `${KGW_PREFIX}${raw.id}`,
    name: raw.name || raw.id,
    contextLength:
      typeof raw.context_length === "number"
        ? raw.context_length
        : raw.top_provider?.context_length ?? null,
    pricing: {
      prompt: normalizePrice(pricing.prompt) ?? null,
      completion: normalizePrice(pricing.completion) ?? null,
    },
    isFree: true,
    supportedParameters: Array.isArray(raw.supported_parameters)
      ? raw.supported_parameters
      : [],
    inputModalities: Array.isArray(arch.input_modalities)
      ? arch.input_modalities
      : [],
    outputModalities: Array.isArray(arch.output_modalities)
      ? arch.output_modalities
      : [],
  };
}

/**
 * Estado del cache: indica si los datos estan frescos.
 */
function isCacheFresh(entry: CacheEntry | null): boolean {
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

/**
 * Obtiene los modelos gratuitos de Kilo AI Gateway, usando el cache si esta fresco.
 * Lanza error si la peticion al catalogo falla.
 */
export async function fetchKiloAiGatewayFreeModels(): Promise<KiloAiGatewayFreeModel[]> {
  if (isCacheFresh(_cache)) {
    return _cache!.models;
  }

  let response: Response;
  try {
    response = await fetch(KILO_AI_GATEWAY_MODELS_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      // Timeout delegado al entorno de ejecucion (Node/Next/fetch).
    });
  } catch (error) {
    // Si hay cache previo (aunque expirado), devolverlo en lugar de fallar.
    if (_cache) return _cache.models;
    throw new Error(
      `Kilo AI Gateway: no se pudo consultar el catalogo de modelos (${KILO_AI_GATEWAY_MODELS_URL}): ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!response.ok) {
    if (_cache) return _cache.models;
    throw new Error(
      `Kilo AI Gateway: el catalogo de modelos respondio ${response.status} ${response.statusText}`
    );
  }

  let data: KiloAiGatewayCatalogResponse;
  try {
    data = (await response.json()) as KiloAiGatewayCatalogResponse;
  } catch (error) {
    if (_cache) return _cache.models;
    throw new Error(
      `Kilo AI Gateway: respuesta del catalogo no es JSON valido: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const rawModels: KiloAiGatewayModelRaw[] = Array.isArray(data.data) ? data.data : [];

  const freeModels: KiloAiGatewayFreeModel[] = [];
  for (const raw of rawModels) {
    const mapped = mapFreeModel(raw);
    if (mapped) freeModels.push(mapped);
  }

  // Ordenar por id para salida estable.
  freeModels.sort((a, b) => a.id.localeCompare(b.id));

  _cache = { models: freeModels, fetchedAt: Date.now() };
  return freeModels;
}

/**
 * Verifica si un identificador de modelo (sin prefijo) es gratuito según el catalogo.
 * Consulta el catalogo si el cache no esta fresco.
 */
export async function isKiloAiGatewayModelFree(modelId: string): Promise<boolean> {
  const models = await fetchKiloAiGatewayFreeModels();
  return models.some((m) => m.id === modelId);
}

/**
 * Obtiene el identificador con prefijo kgw/ para un modelo gratuito.
 * Devuelve null si el modelo no es gratuito o no existe en el catalogo.
 */
export async function resolveKgwPrefixedId(modelId: string): Promise<string | null> {
  const models = await fetchKiloAiGatewayFreeModels();
  const found = models.find((m) => m.id === modelId);
  return found ? found.prefixedId : null;
}

/**
 * Invalida el cache para forzar una nueva consulta en la siguiente llamada.
 * Utilitario para pruebas y recarga manual.
 */
export function invalidateKiloAiGatewayCache(): void {
  _cache = null;
}

/**
 * Devuelve el URL base del gateway (solo para diagnostico/configuracion).
 */
export function getKiloAiGatewayBaseUrl(): string {
  return KILO_AI_GATEWAY_BASE_URL;
}
