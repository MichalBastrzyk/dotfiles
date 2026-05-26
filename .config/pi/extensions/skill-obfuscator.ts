import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Markdown } from "@mariozechner/pi-tui";

const EXPANDED_SKILL_RE = /<skill\s+([^>]*)>[\s\S]*?<\/skill>/g;

function attr(attrs: string, name: string) {
	return attrs.match(new RegExp(`${name}="([^"]+)"`))?.[1];
}

function installMarkdownPatch() {
	const proto = Markdown.prototype as typeof Markdown.prototype & { __skillObfuscatorPatch?: boolean };
	if (proto.__skillObfuscatorPatch) return;
	proto.__skillObfuscatorPatch = true;

	const originalRender = proto.render;
	proto.render = function (width: number) {
		if (!this.text?.includes("<skill ")) {
			return originalRender.call(this, width);
		}

		const originalText = this.text;
		this.text = originalText.replace(EXPANDED_SKILL_RE, (_block, attrs: string) => {
			const name = attr(attrs, "name");
			return name ? `\`/skill:${name}\`` : _block;
		});
		try {
			return originalRender.call(this, width);
		} finally {
			this.text = originalText;
		}
	};}

export default function (_pi: ExtensionAPI) {
	installMarkdownPatch();
}
