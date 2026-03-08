import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import { describe, expect, it } from "bun:test";

import {
	appendPhiSystemReminderToUserContent,
	buildPhiSystemReminder,
} from "@phi/messaging/system-reminder";

describe("buildPhiSystemReminder", () => {
	it("returns undefined without metadata", () => {
		expect(buildPhiSystemReminder(undefined)).toBeUndefined();
	});

	it("renders reminder from cleaned metadata", () => {
		expect(
			buildPhiSystemReminder({
				current_message: {
					message_id: 181,
					from: {
						id: 100,
						first_name: "Zhou",
						last_name: "Rui",
					},
				},
				reply_to_message: {
					message_id: 178,
					from: {
						id: 101,
						first_name: "Phi",
					},
					text: "Here are the two test files:",
					document: {
						file_name: "test_file_1.txt",
					},
				},
				quote: {
					text: "two test files",
					position: 0,
				},
			})
		).toBe(
			[
				"<system-reminder>",
				"current_message:",
				"  message_id: 181",
				"  from:",
				"    id: 100",
				"    first_name: Zhou",
				"    last_name: Rui",
				"reply_to_message:",
				"  message_id: 178",
				"  from:",
				"    id: 101",
				"    first_name: Phi",
				"  text:",
				"  ```text",
				"Here are the two test files:",
				"  ```",
				"  document:",
				"    file_name: test_file_1.txt",
				"quote:",
				"  text:",
				"  ```text",
				"two test files",
				"  ```",
				"  position: 0",
				"</system-reminder>",
			].join("\n")
		);
	});
});

describe("appendPhiSystemReminderToUserContent", () => {
	it("converts plain text into a multipart user message when reminder exists", () => {
		const result = appendPhiSystemReminderToUserContent(
			"hello",
			"<system-reminder>\nctx\n</system-reminder>"
		);

		expect(result).toEqual([
			{ type: "text", text: "hello" },
			{
				type: "text",
				text: "<system-reminder>\nctx\n</system-reminder>",
			},
		]);
	});

	it("appends reminder as the last text part after images", () => {
		const result = appendPhiSystemReminderToUserContent(
			[
				{ type: "text", text: "Describe this image:" },
				{ type: "image", mimeType: "image/jpeg", data: "AQID" },
			] satisfies (TextContent | ImageContent)[],
			"<system-reminder>\nctx\n</system-reminder>"
		) as (TextContent | ImageContent)[];

		expect(result.at(-1)).toEqual({
			type: "text",
			text: "<system-reminder>\nctx\n</system-reminder>",
		});
		expect(result[1]).toEqual({
			type: "image",
			mimeType: "image/jpeg",
			data: "AQID",
		});
	});
});
