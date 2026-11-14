import type { RegistryEntry } from "../../shared.ts";

/**
 * Kilo AI Gateway — proveedor independiente y aislado.
 *
 * Apunta al catálogo público de Kilo AI Gateway en ai-gateway.kilo.ai,
 * totalmente separado del proveedor `kilocode`/`kc` (api.kilo.ai/api/openrouter)
 * y del proveedor `kilo-gateway`/`kg` (api.kilo.ai/api/gateway).
 *
 * Modalidad anónima por defecto (authType: "optional"): sin credenciales se
 * envía `Authorization: Bearer anonymous`. Solo se enrutan modelos que el
 * catálogo identifique inequívocamente como gratuitos (isFree === true y
 * pricing.prompt/completion === "0").
 *
 * No reutiliza credenciales de kc/ ni kilocode/. No introduce nuevas API keys.
 * Los modelos de pago quedan bloqueados en modalidad anónima.
 */
export const kiloAiGatewayProvider: RegistryEntry = {
  id: "kilo-ai-gateway",
  alias: "kgw",
  format: "openai",
  executor: "default",
  baseUrl: "https://ai-gateway.kilo.ai/api/v1/chat/completions",
  modelsUrl: "https://ai-gateway.kilo.ai/api/v1/models",
  authType: "optional",
  authHeader: "bearer",
  // Kilo AI Gateway acepta peticiones anonimas sin header de autorizacion.
  // anonymousApiKey permite al DefaultExecutor enviar `Bearer anonymous`
  // cuando no hay credencial configurada, sin afectar la ruta autenticada.
  anonymousApiKey: "anonymous",
  headers: {
    "X-KILO-AI-GATEWAY": "OmniRoute",
  },
  // Modelo passthrough: acepta cualquier identificador de modelo con el
  // prefijo kgw/. El filtrado de solo-gratis se aplica en la capa de
  // descubrimiento y en la guarda de enrutamiento (ver kiloAiGatewayDiscovery).
  passthroughModels: true,
  // El catalogo dinamico es la fuente de modelos; no se fijan modelos
  // estaticos para evitar listas de gratis hardcodeadas.
  models: [],
  liveCatalogAuthoritative: false,
};
