// After the documented UI steps, verify the actual request received by the local fixture.
import assert from "node:assert/strict";
const calls = await (await fetch("http://127.0.0.1:3421/qa/requests")).json();
const request = calls.find((call) => call.path === "/v1/images/generations" && call.prompt?.includes("公共画风同步验收"));
assert.ok(request, "先在隔离测试画布连接公共画风、人物、动作模块并点击生成");
assert.equal(request.authorized, true);
for (const text of ["公共画风同步验收", "一对成年新人", "女左男右"]) {
    assert.equal(request.prompt.split(text).length - 1, 1, `${text} 应完整合并且只出现一次`);
}
console.log("PASS: 拖入模块的连线内容已进入实际请求，无丢失或重复；仅调用本机模拟服务。");
