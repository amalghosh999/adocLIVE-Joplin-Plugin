import { highlightRenderedSourceBlocksInHtml } from "../lib/utils/rendered-highlight";
import { prepareAsciiDocMathForRendering } from "../lib/utils/rendered-math";

let asciidoctorInstance: any = null;

function getAsciidoctor() {
  if (!asciidoctorInstance) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Asciidoctor = require("asciidoctor");
    asciidoctorInstance = Asciidoctor();
  }
  return asciidoctorInstance;
}

/** Shared behavior-preserving production/lab AsciiDoc rendering core. */
export function renderAsciiDocHtml(source: string, settings: Record<string, any> = {}): string {
  try {
    const attributes: Record<string, string> = {
      showtitle: "true",
      icons: "font",
      ...(settings.attributes || {}),
    };
    const preparedMath = prepareAsciiDocMathForRendering(source, { attributes });
    const html = getAsciidoctor().convert(preparedMath.source, {
      safe: "safe",
      backend: "html5",
      standalone: false,
      attributes,
    });
    return highlightRenderedSourceBlocksInHtml(preparedMath.renderHtml(String(html)));
  } catch (error: any) {
    return `<div class="render-error"><h3>AsciiDoc Render Error</h3><pre>${
      (error?.message || String(error)).replace(/</g, "&lt;").replace(/>/g, "&gt;")
    }</pre></div>`;
  }
}
