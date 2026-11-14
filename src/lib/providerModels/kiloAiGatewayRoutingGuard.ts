/**
 * kiloAiGatewayRoutingGuard.ts — Guarda de enrutamiento para Kilo AI Gateway.
 *
 * Impide que se enruten modelos de pago a traves del proveedor
 * kilo-ai-gateway (kgw/) en modalidad anonima. Un modelo solo se permite
 * cuando el catalogo de Kilo AI Gateway lo identifica inequívocamente como
 * gratuito (isFree === true y pricing.prompt/completion === "0").
 *
 * Esta guarda es independiente de kc/, kilocode/ y cualquier otro proveedor.
 * No modifica credenciales ni configuraciones existentes.
 */

import {
  fetchKiloAiGatewayFreeModels,
  resolveKgwPrefixedId,
  type KiloAiGatewayFreeModel,
} from "./kiloAiGatewayDiscovery.ts";

/** Resultado de la comprobacion de enrutamiento. */
export type KgwRoutingDecision = {
  /** true si el modelo puede enviarse a Kilo AI Gateway. */
  allowed: boolean;
  /** Identificador con prefijo kgw/ a enviar al upstream, o null si no permitido. */
  prefixedModelId: string | null;
  /** Razon de la decision (para logs y mensajes de error). */
  reason: "free-model" | "paid-model" | "unknown-model" | "catalog-error";
  /** Mensaje descriptivo. */
  message: string;
};

/** Modelos gratuitos en memoria (cache de corto plazo para la guarda). */
let _freeModelsCache: KiloAiGatewayFreeModel[] | null = null;
let _freeModelsCacheAt: number = 0;
const FREE_MODELS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutos

function isFreeModelsCacheFresh(): boolean {
  return Boolean(_freeModelsCache && Date.now() - _freeModelsCacheAt < FREE_MODELS_CACHE_TTL_MS);
}

async function getFreeModels(): Promise<KiloAiGatewayFreeModel[]> {
  if (isFreeModelsCacheFresh()) return _freeModelsCache!;
  const models = await fetchKiloAiGatewayFreeModels();
  _freeModelsCache = models;
  _freeModelsCacheAt = Date.now();
  return models;
}

/**
 * Evalua si un identificador de modelo con prefijo kgw/ puede enviarse a
 * Kilo AI Gateway.
 *
 * - "kgw/kilo-auto/free" -> permitido (modelo gratuito confirmado)
 * - "kgw/anthropic/claude-sonnet-4.6" -> denegado (modelo de pago)
 * - "kgw/cualquier-cosa-no-en-catalogo" -> denegado (modelo desconocido)
 * - Cualquier otro prefijo -> permitido (no es responsabilidad de esta guarda)
 */
export async function evaluateKgwRouting(
  modelId: string
): Promise<KgwRoutingDecision> {
  // Solo aplica a modelos con el prefijo kgw/.
  if (!modelId.startsWith("kgw/")) {
    return {
      allowed: true,
      prefixedModelId: modelId,
      reason: "free-model",
      message: "Modelo sin prefijo kgw/: no gestionado por esta guarda.",
    };
  }

  // Extraer el identificador original sin el prefijo kgw/.
  // El prefijo se elimina exactamente una vez; se conserva el resto, incluidas
  // barras internas (ej. "nvidia/nemotron-3.5-super-vl:free").
  const originalModelId = modelId.slice("kgw/".length);

  if (!originalModelId || originalModelId === "kgw") {
    return {
      allowed: false,
      prefixedModelId: null,
      reason: "unknown-model",
      message: "Identificador de modelo vacio despues del prefijo kgw/.",
    };
  }

  try {
    const freeModels = await getFreeModels();
    const found = freeModels.find((m) => m.id === originalModelId);

    if (!found) {
      return {
        allowed: false,
        prefixedModelId: null,
        reason: "unknown-model",
        message: `Modelo "${originalModelId}" no esta en el catalogo gratuito de Kilo AI Gateway. Los modelos de pago y los no identificados como gratuitos están bloqueados en modalidad anonima.`,
      };
    }

    return {
      allowed: true,
      prefixedModelId: found.prefixedId,
      reason: "free-model",
      message: `Modelo gratuito confirmado: ${found.name} (${found.id}).`,
    };
  } catch (error) {
    return {
      allowed: false,
      prefixedModelId: null,
      reason: "catalog-error",
      message: `No se pudo verificar el modelo "${originalModelId}" contra el catalogo de Kilo AI Gateway: ${error instanceof Error ? error.message : String(error)}. En modalidad anonima se bloquea ante cualquier duda.`,
    };
  }
}

/**
 * Version sincronizada (fail-closed) para contextos donde no se puede esperar
 * a una peticion de red. Deniega todo salvo que el modelo ya este en cache.
 */
export function evaluateKgwRoutingSync(modelId: string): KgwRoutingDecision {
  if (!modelId.startsWith("kgw/")) {
    return {
      allowed: true,
      prefixedModelId: modelId,
      reason: "free-model",
      message: "Modelo sin prefijo kgw/: no gestionado por esta guarda.",
    };
  }

  const originalModelId = modelId.slice("kgw/".length);
  if (!originalModelId || originalModelId === "kgw") {
    return {
      allowed: false,
      prefixedModelId: null,
      reason: "unknown-model",
      message: "Identificador de modelo vacio despues del prefijo kgw/.",
    };
  }

  if (!_freeModelsCache) {
    return {
      allowed: false,
      prefixedModelId: null,
      reason: "catalog-error",
      message: "Cache de modelos gratuitos no disponible y no se puede consultar el catalogo de forma sincrona. Modelo bloqueado por seguridad.",
    };
  }

  const found = _freeModelsCache.find((m) => m.id === originalModelId);
  if (!found) {
    return {
      allowed: false,
      prefixedModelId: null,
      reason: "unknown-model",
      message: `Modelo "${originalModelId}" no esta en el cache de modelos gratuitos de Kilo AI Gateway.`,
    };
  }

  return {
    allowed: true,
    prefixedModelId: found.prefixedId,
    reason: "free-model",
    message: `Modelo gratuito confirmado (cache): ${found.name}.`,
  };
}

/**
 * Invalida el cache local de la guarda.
 */
export function invalidateKgwRoutingGuardCache(): void {
  _freeModelsCache = null;
  _freeModelsCacheAt = 0;
}
