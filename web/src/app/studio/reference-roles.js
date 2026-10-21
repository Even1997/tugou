export const referenceRolePresets = [
    { label: "人物身份", value: "仅参考人物身份与辨识特征，画法遵循画风模块，不继承照片服饰和背景" },
    { label: "画风", value: "仅参考线条、色彩、明暗和简化程度，不继承人物身份与构图" },
    { label: "动作", value: "仅参考姿势、朝向与人物互动，不继承身份和服饰" },
    { label: "服饰", value: "仅参考服饰款式、配色和配件" },
    { label: "背景", value: "仅参考场景、空间关系与背景元素" },
    { label: "道具 / 宠物", value: "仅参考道具或宠物的外形、花纹与辨识特征" },
    { label: "材质", value: "仅参考表面材质与纹理，不继承形状和构图" },
    { label: "构图", value: "仅参考主体位置、比例和留白" },
];

/** @param {{assetId: string, role: string}[]} references */
export function uniqueReferences(references) {
    const result = new Map();
    for (const ref of references) {
        const prior = result.get(ref.assetId);
        const role = ref.role.trim();
        if (!prior) result.set(ref.assetId, { assetId: ref.assetId, role });
        else if (role && !prior.role.split("；").includes(role)) prior.role = [prior.role, role].filter(Boolean).join("；");
    }
    return /** @type {{assetId: string, role: string}[]} */ ([...result.values()]);
}

/** @param {(string | undefined)[]} roles */
export function referenceRoleBlock(roles) {
    const lines = roles.flatMap((role, i) => role?.trim() ? [`图片${i + 1}：${role.trim()}`] : []);
    return lines.length ? `【参考图职责】\n${lines.join("\n")}` : "";
}
