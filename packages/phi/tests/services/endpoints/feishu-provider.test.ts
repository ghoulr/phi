import { describe, expect, it } from "bun:test";

import { __test__ } from "@phi/services/endpoints/feishu-provider";

describe("feishu provider helpers", () => {
	it("parses text, image, and file message content", () => {
		expect(
			__test__.parseMessageContent({
				sender: {
					sender_type: "user",
				},
				message: {
					message_id: "m1",
					create_time: "1",
					chat_id: "c1",
					chat_type: "group",
					message_type: "text",
					content: JSON.stringify({ text: "hello" }),
				},
			})
		).toEqual({
			text: "hello",
			raw: { text: "hello" },
		});
		expect(
			__test__.parseMessageContent({
				sender: {
					sender_type: "user",
				},
				message: {
					message_id: "m2",
					create_time: "1",
					chat_id: "c1",
					chat_type: "group",
					message_type: "image",
					content: JSON.stringify({ image_key: "img_1" }),
				},
			})
		).toEqual({
			attachment: {
				resourceType: "image",
				resourceKey: "img_1",
				fileName: "image",
			},
			raw: { image_key: "img_1" },
		});
		expect(
			__test__.parseMessageContent({
				sender: {
					sender_type: "user",
				},
				message: {
					message_id: "m3",
					create_time: "1",
					chat_id: "c1",
					chat_type: "group",
					message_type: "file",
					content: JSON.stringify({
						file_key: "file_1",
						file_name: "a.pdf",
					}),
				},
			})
		).toEqual({
			attachment: {
				resourceType: "file",
				resourceKey: "file_1",
				fileName: "a.pdf",
			},
			raw: { file_key: "file_1", file_name: "a.pdf" },
		});
	});

	it("fails fast when attachment content key is missing", () => {
		expect(() =>
			__test__.parseMessageContent({
				sender: {
					sender_type: "user",
				},
				message: {
					message_id: "m2",
					create_time: "1",
					chat_id: "c1",
					chat_type: "group",
					message_type: "image",
					content: JSON.stringify({}),
				},
			})
		).toThrow("Feishu image message is missing image_key.");
	});

	it("splits outbound text by payload limit", () => {
		const largeText = "你 ".repeat(120000);
		const chunks = __test__.splitFeishuText(largeText);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(
				Buffer.byteLength(
					__test__.buildFeishuTextContent(chunk),
					"utf8"
				)
			).toBeLessThanOrEqual(150 * 1024);
		}
	});

	it("extracts filename from content disposition", () => {
		expect(
			__test__.parseContentDispositionFileName({
				"content-disposition": 'attachment; filename="report.pdf"',
			})
		).toBe("report.pdf");
		expect(
			__test__.parseContentDispositionFileName({
				"content-disposition":
					"attachment; filename*=UTF-8''hello%20world.txt",
			})
		).toBe("hello world.txt");
	});
});
