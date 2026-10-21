import { blankProject, commonStyle, createLayer, recipeFingerprint, type PromptModule, type Recipe } from "./model";
import { readAsset } from "./client-api";

export async function demoProject() {
    const p = blankProject();
    p.name = "蓝白花园 · C 版";
    const parts: [string, string, string, string][] = [
        ["style", "公共画风", "style", commonStyle],
        ["identity", "人物身份", "人物", "一对成年新人，保留各自的脸型、眉眼关系、发型和有辨识度的配饰。采用亲切的清线卡通造型，约七头身，鼻口简化，头发按发束概括。替换人物时，以指定的身份照片为准，照片只提供身份，不继承摄影光影和背景。"],
        ["pose", "动作与表情", "动作", "女左男右，靠近站立。新娘右手轻挽新郎左臂，左手持花；新郎左臂自然弯曲，右手插袋。两人轻轻转头望向对方，保留四分之三面部，温柔自然地微笑。"],
        ["clothes", "服饰与配饰", "服饰", "新娘穿象牙白方领无袖 A 字婚纱与轻薄头纱；新郎穿奶油白西装、白衬衫、雾蓝领结、深灰长裤和棕色皮鞋。蓝白色小捧花，柔和叶绿与雾蓝丝带。"],
        ["scene", "花园背景", "背景", "清新蓝白花园，白色花架，远景树木和低矮灌木，奶油白与雾蓝花朵，底部草地轻盈疏朗。中央留出人物站立位置，不出现人物或文字。"],
        ["decor", "角落花簇", "装饰", "蓝白色玫瑰和小花、叶绿枝叶组成横向花簇，疏密自然，适合作为版面角落装饰。只有花簇，没有容器或背景。"],
        ["paper", "纸张材质", "材质", "暖象牙白棉纸底纹，极浅细腻纤维，无褶皱、污点、边框、文字或物体。整体明亮，纹理克制。"],
    ];
    p.modules = parts.map(([id, name, kind, text]): PromptModule => ({ id, name, kind, text, global: kind === "style" }));
    p.recipes = [
        {
            id: "couple",
            name: "双人人物",
            moduleIds: ["identity", "pose", "clothes"],
            references: [],
            output: "竖版 2:3，完整全身，两人居中，四周留透明边距，不裁头发、裙摆与鞋。仅人物素材，无地面、纸纹、背景、文字。需要真实透明 alpha，不绘制棋盘格。",
            size: "1024x1536",
        },
        { id: "garden", name: "花园背景", moduleIds: ["scene"], references: [], output: "竖版 2:3，场景边缘轻盈，真实透明背景，中央留白，不添加人物和文字。", size: "1024x1536" },
        { id: "flower", name: "花簇装饰", moduleIds: ["decor"], references: [], output: "横向 3:2，完整花簇，真实透明背景，四周留白。", size: "1536x1024" },
        { id: "paper-bg", name: "纸张底纹", moduleIds: ["paper"], references: [], output: "竖版 2:3，满幅不透明纸张底纹。", size: "1024x1536" },
    ] satisfies Recipe[];
    const sources = [
        ["01-paper.png", "纸张底纹", "paper-bg"],
        ["02-scene.png", "花园背景", "garden"],
        ["03-couple.png", "双人人物", "couple"],
        ["04-flowers.png", "花簇装饰", "flower"],
    ];
    p.assets = await Promise.all(
        sources.map(async ([file, name, recipeId]) => {
            const r = await fetch(`/studio-demo/${file}`);
            if (!r.ok) throw new Error("示例素材未安装");
            const a = await readAsset(await r.blob(), name);
            return {
                ...a,
                recipeId,
                model: "用户认可的 C 版素材",
                fingerprint: recipeFingerprint(
                    p,
                    p.recipes.find((r) => r.id === recipeId)!,
                ),
            };
        }),
    );
    const placements = [
        [0, 0, 1024, 1536, 0.35],
        [80, 200, 864, 1296, 1],
        [230, 600, 560, 840, 1],
        [710, 1270, 240, 160, 1],
    ];
    p.layers = p.assets.map((a, i) => ({ ...createLayer("image", a.name), assetId: a.id, x: placements[i][0], y: placements[i][1], width: placements[i][2], height: placements[i][3], opacity: placements[i][4] }));
    p.layers.push({ ...createLayer("text", "主标题"), text: "我们结婚啦", x: 112, y: 92, width: 800, height: 100, fontSize: 62, color: "#4c6559", fontFamily: "Microsoft YaHei" });
    p.layers.push({ ...createLayer("text", "邀请语"), text: "邀你见证 · 属于我们的美好时刻", x: 112, y: 210, width: 800, height: 60, fontSize: 24, color: "#6d7c72", fontFamily: "Microsoft YaHei" });
    return p;
}
