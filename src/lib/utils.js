import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Junta classes condicionais e resolve conflitos do Tailwind — a última vence.
 * Sem isso, `cn("p-2", "p-4")` deixaria as duas no DOM e o resultado dependeria
 * da ordem no CSS gerado, não da ordem da chamada.
 * Todo componente do shadcn/ui importa daqui.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
