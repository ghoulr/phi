import { describe, expect, it } from "bun:test";

import type { Skill } from "@mariozechner/pi-coding-agent";

import {
	applySkillEnvOverrides,
	resolveLoadedSkillEnvOverrides,
} from "@phi/core/skill-env";

function createSkill(name: string): Skill {
	return {
		name,
		description: `${name} description`,
		filePath: `/tmp/${name}/SKILL.md`,
		baseDir: `/tmp/${name}`,
		source: "path",
		disableModelInvocation: false,
	};
}

describe("skill env", () => {
	it("resolves env only for loaded skills and restores them after cleanup", () => {
		const previousValue = process.env.EXAMPLE_TOKEN;
		delete process.env.EXAMPLE_TOKEN;

		const overrides = resolveLoadedSkillEnvOverrides({
			skills: [createSkill("loaded-skill")],
			workspaceConfig: {
				skills: {
					entries: {
						"loaded-skill": {
							env: { EXAMPLE_TOKEN: "loaded" },
						},
						"other-skill": {
							env: { EXAMPLE_TOKEN: "other" },
						},
					},
				},
			},
			configFilePath: "/tmp/config.yaml",
		});
		expect(overrides).toEqual({ EXAMPLE_TOKEN: "loaded" });

		const restore = applySkillEnvOverrides(overrides);
		const appliedValue: string | undefined = process.env.EXAMPLE_TOKEN;
		expect(appliedValue === "loaded").toBe(true);
		restore();
		const restoredValue: string | undefined = process.env.EXAMPLE_TOKEN;
		expect(restoredValue === previousValue).toBe(true);
	});

	it("fails on conflicting env values from multiple loaded skills", () => {
		expect(() =>
			resolveLoadedSkillEnvOverrides({
				skills: [createSkill("alpha"), createSkill("beta")],
				workspaceConfig: {
					skills: {
						entries: {
							alpha: {
								env: { SHARED_TOKEN: "one" },
							},
							beta: {
								env: { SHARED_TOKEN: "two" },
							},
						},
					},
				},
				configFilePath: "/tmp/config.yaml",
				processEnv: {},
			})
		).toThrow("Conflicting skill env override for SHARED_TOKEN: beta");
	});

	it("fails when another active session already holds the same env key with a different value", () => {
		const restore = applySkillEnvOverrides({ SHARED_TOKEN: "one" });
		try {
			const overrides = resolveLoadedSkillEnvOverrides({
				skills: [createSkill("beta")],
				workspaceConfig: {
					skills: {
						entries: {
							beta: {
								env: { SHARED_TOKEN: "two" },
							},
						},
					},
				},
				configFilePath: "/tmp/config.yaml",
			});
			expect(() => applySkillEnvOverrides(overrides)).toThrow(
				"Conflicting active skill env override for SHARED_TOKEN"
			);
		} finally {
			restore();
		}
	});
});
