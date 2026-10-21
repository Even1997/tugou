import test from "node:test";
import assert from "node:assert/strict";
import { parseCube, applyCubeRgba } from "../src/app/api/studio/cube-lut.js";
const identity = `TITLE "identity"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1`;
test("3D identity 插值保留 RGB/Alpha；DOMAIN、夹取和强度正确", async () => {
    const data = Buffer.from([63, 127, 191, 77, 0, 255, 130, 255]); const expected = Buffer.from(data);
    await applyCubeRgba(data, parseCube(identity), 1, new AbortController().signal); assert.deepEqual(data, expected);
    const domain = parseCube(identity.replace('LUT_3D_SIZE 2', 'DOMAIN_MIN -1 -1 -1\nDOMAIN_MAX 1 1 1\nLUT_3D_SIZE 2'));
    const sample = Buffer.from([0, 127, 255, 128]); await applyCubeRgba(sample, domain, 1, new AbortController().signal);
    assert.deepEqual([...sample], [128, 191, 255, 128]);
    const black = parseCube(identity.replace(/1/g, '0').replace('SIZE 2', 'SIZE 2'));
    const half = Buffer.from([100, 200, 60, 33]); await applyCubeRgba(half, black, .5, new AbortController().signal); assert.deepEqual([...half], [50, 100, 30, 33]);
});
test("1D 分通道插值、零强度及取消", async () => {
    const cube = parseCube('LUT_1D_SIZE 2\n1 0 0\n0 1 1');
    const data = Buffer.from([64, 128, 255, 19]); await applyCubeRgba(data, cube, 1, new AbortController().signal); assert.deepEqual([...data], [191, 128, 255, 19]);
    const same = Buffer.from(data); await applyCubeRgba(data, cube, 0, new AbortController().signal); assert.deepEqual(data, same);
    const signal = AbortSignal.abort(new Error('取消')); await assert.rejects(applyCubeRgba(data, cube, 1, signal), /取消/);
});
test("无效点数、重复头部、未知格式、非有限数据和逆 DOMAIN 都拒绝", () => {
    for (const text of ['LUT_3D_SIZE 999', 'LUT_3D_SIZE 2\n0 0 0', `${identity}\n0 0 0`, identity.replace('0 0 0', 'NaN 0 0'), `DOMAIN_MIN 1 0 0\nDOMAIN_MAX 1 1 1\n${identity}`, `LUT_1D_SIZE 2\n${identity}`, `LUT_3D_INPUT_RANGE 0 1\n${identity}`]) assert.throws(() => parseCube(text));
});
