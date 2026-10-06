import assert from "node:assert/strict";
import { test } from "node:test";
import { avatarHex } from "./avatar-colours.ts";
import { avatarSvg } from "./avatar-svg.ts";

const agent = { id: "agent-1", name: "compass", colour: 3, face: "idle" as const };
const eyesOf = (svg: string) => /id="eyes-([a-z]+)/.exec(svg)![1];

test("a gaze avatar wears the agent's own colour, its own eyes at rest, and the expressive ones only for an outcome", () => {
  const idle = avatarSvg("gaze", agent);
  assert.ok(idle.includes(`fill="${avatarHex(3)}"`), "the body is the agent's colour");
  for (let i = 0; i < 60; i++) {
    const resting = eyesOf(avatarSvg("gaze", { ...agent, id: `agent-${i}` }))!;
    // Named here, not read from the module: the list under test cannot vouch for itself.
    assert.ok(!["happy", "small", "grin", "squint", "bars"].includes(resting), `agent-${i} rests with ${resting}, an expression`);
  }
  assert.equal(eyesOf(avatarSvg("gaze", { ...agent, face: "done" })), "happy");
  assert.equal(eyesOf(avatarSvg("gaze", { ...agent, face: "failed" })), "small");
  // Every face but an outcome keeps the agent's own eyes; the rest of the state is motion (index.css).
  for (const face of ["open", "thinking", "tool", "answering", "broken"] as const)
    assert.equal(eyesOf(avatarSvg("gaze", { ...agent, face })), eyesOf(idle), face);
});

test("an avatar is drawn once, follows the agent rather than its name, and never shares an id with another", () => {
  assert.equal(avatarSvg("gaze", agent), avatarSvg("gaze", agent), "the same avatar is the same string");
  const renamed = avatarSvg("moods", { ...agent, name: "renamed" });
  // Only the random part of the ids may differ.
  const drawing = (svg: string) => svg.replace(/-[0-9a-f]{6}(?=["#)])/g, "");
  assert.equal(drawing(renamed), drawing(avatarSvg("moods", agent)), "a rename keeps the face");
  const ids = (svg: string) => new Set([...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  // One agent twice with two faces: without unique ids the second <use> draws the first one's eyes.
  const a = ids(avatarSvg("gaze", agent));
  const b = ids(avatarSvg("gaze", { ...agent, face: "done" }));
  assert.ok(a.size > 0 && [...a].every((id) => !b.has(id)), "one agent's two faces cannot draw each other's parts");
  for (const style of ["moods", "clay", "bottts", "pixelbot", "initialFace"] as const) {
    // Named per style, not read from the module: two agents with different colour numbers never wear the same.
    for (const colour of [0, 1, 2, 3, 4])
      assert.ok(avatarSvg(style, { ...agent, colour }).includes(`"${avatarHex(colour)}"`), `${style} wears colour ${colour}`);
    // The clip's corner radius is half its side, in whatever units the style's canvas has (Bottts' is 120).
    const clip = /<clipPath[^>]*><rect width="(\d+)" height="\d+" rx="(\d+)"/.exec(avatarSvg(style, agent));
    assert.ok(clip && Number(clip[2]) * 2 === Number(clip[1]), `${style} is cut to a circle, as every avatar is: ${clip?.[0]}`);
  }
});
