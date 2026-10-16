import fsp from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildSystemPrompt } from "../src/persona/prompt.js";
import { createPersonaFixture, testLogger } from "./helpers.js";
import { PersonaLoader } from "../src/persona/loader.js";

let cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.map((fn) => fn()));
  cleanups = [];
});

describe("persona loader", () => {
  it("combines every markdown and text file", async () => {
    const fixture = await createPersonaFixture({
      "bio.md": "I build things.",
      "faq.txt": "Q: Why? A: Because.",
      "ignored.json": "{}",
    });
    cleanups.push(fixture.cleanup);

    const snapshot = fixture.loader.current();

    expect(snapshot.files.map((f) => f.name)).toEqual(["bio.md", "faq.txt"]);
    expect(snapshot.content).toContain("I build things.");
    expect(snapshot.content).toContain("Q: Why? A: Because.");
    expect(snapshot.content).not.toContain("{}");
  });

  it("orders files deterministically so the cached prompt prefix is stable", async () => {
    const fixture = await createPersonaFixture({
      "zeta.md": "last",
      "alpha.md": "first",
      "middle.md": "second",
    });
    cleanups.push(fixture.cleanup);

    const first = fixture.loader.current();
    const second = await fixture.loader.reload();

    expect(first.files.map((f) => f.name)).toEqual(["alpha.md", "middle.md", "zeta.md"]);
    expect(second.hash).toBe(first.hash);
    expect(second.content).toBe(first.content);
  });

  it("changes its hash only when the content changes", async () => {
    const fixture = await createPersonaFixture({ "bio.md": "before" });
    cleanups.push(fixture.cleanup);

    const before = fixture.loader.current().hash;
    await fsp.writeFile(path.join(fixture.dir, "bio.md"), "after", "utf8");
    const after = (await fixture.loader.reload()).hash;

    expect(after).not.toBe(before);
  });

  it("survives a missing persona directory", async () => {
    const loader = new PersonaLoader({
      dir: path.join(process.cwd(), "definitely-not-a-real-directory"),
      watch: false,
      logger: testLogger(),
    });

    const snapshot = await loader.init();

    expect(snapshot.content).toBe("");
    expect(snapshot.files).toEqual([]);
    loader.close();
  });
});

describe("system prompt", () => {
  it("embeds the persona corpus", async () => {
    const fixture = await createPersonaFixture({ "bio.md": "I am a lighthouse keeper." });
    cleanups.push(fixture.cleanup);

    const prompt = buildSystemPrompt(fixture.loader.current());

    expect(prompt).toContain("I am a lighthouse keeper.");
    expect(prompt).toContain("first person");
  });

  it("says so explicitly when there is no persona to speak from", async () => {
    const fixture = await createPersonaFixture({});
    cleanups.push(fixture.cleanup);

    expect(buildSystemPrompt(fixture.loader.current())).toContain(
      "No persona files found",
    );
  });

  it("is byte-identical for an unchanged corpus", async () => {
    const fixture = await createPersonaFixture({ "bio.md": "Stable." });
    cleanups.push(fixture.cleanup);

    const snapshot = fixture.loader.current();
    expect(buildSystemPrompt(snapshot)).toBe(buildSystemPrompt(snapshot));
  });
});
