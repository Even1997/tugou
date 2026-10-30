import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useEffect,
  useState,
  useRef,
} from "react";
import {
  Button as AntButton,
  Checkbox,
  ConfigProvider,
  Input,
  Modal,
  Popover,
  Tooltip,
  theme as antTheme,
} from "antd";
import {
  AppstoreOutlined,
  ApartmentOutlined,
  PictureOutlined,
  PlusOutlined,
  SearchOutlined,
  DeleteOutlined,
  CopyOutlined,
  UploadOutlined,
  DownloadOutlined,
  SaveOutlined,
  SettingOutlined,
  SunOutlined,
  MoonOutlined,
  MoreOutlined,
  UndoOutlined,
  RedoOutlined,
  CloseOutlined,
  MinusOutlined,
  ExpandOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  LockOutlined,
  UnlockOutlined,
  BgColorsOutlined,
  UserOutlined,
  DragOutlined,
  SkinOutlined,
  EnvironmentOutlined,
  StarOutlined,
  FontSizeOutlined,
  ProductOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  FolderOpenOutlined,
  CheckOutlined,
  AimOutlined,
  EditOutlined,
  SwapOutlined,
  CameraOutlined,
  VideoCameraOutlined,
  SoundOutlined,
  RobotOutlined,
  StopOutlined,
  BlockOutlined,
  ToolOutlined,
  SelectOutlined,
  ScissorOutlined,
  HighlightOutlined,
  ClearOutlined,
  SlidersOutlined,
  LayoutOutlined,
  GatewayOutlined,
  BorderOuterOutlined,
  SnippetsOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  SyncOutlined,
  FileSearchOutlined,
  FilterOutlined,
  InfoCircleOutlined,
  BuildOutlined,
  LoadingOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  RightOutlined,
  DownOutlined,
  DeploymentUnitOutlined,
  AlignLeftOutlined,
} from "@ant-design/icons";
import {usePreferences} from './preferences.jsx';
import {messages} from './settings-messages.js';
import zhCN from 'antd/locale/zh_CN';
import zhTW from 'antd/locale/zh_TW';
import enUS from 'antd/locale/en_US';
import jaJP from 'antd/locale/ja_JP';
import koKR from 'antd/locale/ko_KR';
const commonLabels=Object.fromEntries(Object.entries(messages['zh-CN']).map(([key,label])=>[label,key]));

const icons = {
  edit: EditOutlined,
  replace: SwapOutlined,
  camera: CameraOutlined,
  video: VideoCameraOutlined,
  audio: SoundOutlined,
  model: RobotOutlined,
  stop: StopOutlined,
  tools: ToolOutlined,
  brand: AppstoreOutlined,
  prompts: ApartmentOutlined,
  canvas: DeploymentUnitOutlined,
  layers: BlockOutlined,
  assets: PictureOutlined,
  add: PlusOutlined,
  search: SearchOutlined,
  delete: DeleteOutlined,
  copy: CopyOutlined,
  import: UploadOutlined,
  export: DownloadOutlined,
  save: SaveOutlined,
  settings: SettingOutlined,
  sun: SunOutlined,
  moon: MoonOutlined,
  more: MoreOutlined,
  undo: UndoOutlined,
  redo: RedoOutlined,
  close: CloseOutlined,
  minimize: MinusOutlined,
  maximize: ExpandOutlined,
  visible: EyeOutlined,
  hidden: EyeInvisibleOutlined,
  locked: LockOutlined,
  unlocked: UnlockOutlined,
  style: BgColorsOutlined,
  character: UserOutlined,
  action: DragOutlined,
  clothing: SkinOutlined,
  background: EnvironmentOutlined,
  decoration: StarOutlined,
  text: FontSizeOutlined,
  other: ProductOutlined,
  generate: ThunderboltOutlined,
  tasks: ClockCircleOutlined,
  open: FolderOpenOutlined,
  check: CheckOutlined,
  fit: AimOutlined,
  select: SelectOutlined,
  brush: HighlightOutlined,
  eraser: ClearOutlined,
  crop: ScissorOutlined,
  adjust: SlidersOutlined,
  layout: LayoutOutlined,
  align: AlignLeftOutlined,
  transform: GatewayOutlined,
  selection: BorderOuterOutlined,
  mask: BuildOutlined,
  paste: SnippetsOutlined,
  zoomIn: ZoomInOutlined,
  zoomOut: ZoomOutOutlined,
  sync: SyncOutlined,
  analyze: FileSearchOutlined,
  filter: FilterOutlined,
  info: InfoCircleOutlined,
  loading: LoadingOutlined,
  up: ArrowUpOutlined,
  down: ArrowDownOutlined,
  expand: RightOutlined,
  collapse: DownOutlined,
};
export function Icon({ name, className = "", ...props }) {
  const Component = icons[name] || ProductOutlined;
  return <Component aria-hidden="true" spin={name === "loading"} className={`${name === "collapse" || name === "expand" ? "disclosure-icon" : ""} ${className}`} {...props} />;
}
const ThemeContext = createContext({ mode: "dark" });
export function useTheme() {
  return useContext(ThemeContext);
}
export function ThemeProvider({ children }) {
  const {value,save,locale}=usePreferences();
  const [systemDark,setSystemDark]=useState(()=>matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)'),change=()=>setSystemDark(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  const mode=value.theme==='system'?(systemDark?'dark':'light'):value.theme;
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = mode;
    localStorage.setItem("tugou-theme", mode);
  }, [mode]);
  const dark = mode === "dark";
  return (
    <ThemeContext.Provider
      value={{ mode, toggle: () => save({theme:dark ? "light" : "dark"}).catch(()=>{}) }}
    >
      <ConfigProvider
        locale={{'zh-CN':zhCN,'zh-TW':zhTW,en:enUS,ja:jaJP,ko:koKR}[locale]}
        csp={{ nonce: "tugou-ui" }}
        button={{ autoInsertSpace: false }}
        theme={{
          algorithm: dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
          token: {
            colorPrimary: dark ? "#b8c5ff" : "#5368be",
            colorBgContainer: dark ? "#181b21" : "#f0f3f8",
            colorBgElevated: dark ? "#20232a" : "#ffffff",
            colorText: dark ? "#f1f3f8" : "#202a3b",
            colorTextSecondary: dark ? "#a9b0c0" : "#56637a",
            colorBorder: dark ? "#353a46" : "#cdd5e1",
            borderRadius: 8,
            fontSize: 13,
            controlHeight: 38,
            fontFamily: '-apple-system, "Segoe UI Variable", "PingFang SC", "Microsoft YaHei UI", sans-serif',
            motion: false,
          },
          components: {
            Button: { defaultShadow: "none", primaryShadow: "none", primaryColor: dark ? "#1c2440" : "#ffffff" },
            Input: { paddingBlock: 7 },
            Modal: { paddingContentHorizontalLG: 24 },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
// Preserve native submit/button semantics while sharing appearance and icon-only accessibility.
export function Button({
  type = "button",
  primary,
  className = "",
  icon,
  iconOnly = false,
  title,
  children,
  ...props
}) {
  const preferences=usePreferences();
  const translated=typeof children==='string'&&commonLabels[children];
  if(translated&&preferences)children=preferences.t(translated);
  const label = props["aria-label"] || (typeof children === "string" ? children : title);
  const button = (
    <AntButton
      {...props}
      aria-label={iconOnly ? label : props["aria-label"]}
      title={iconOnly ? undefined : title}
      htmlType={type === "submit" ? "submit" : "button"}
      type={
        primary || className.split(" ").includes("primary")
          ? "primary"
          : type === "default"
            ? "default"
            : "text"
      }
      className={`${className}${iconOnly ? " icon-button" : ""}`}
      icon={typeof icon === "string" ? <Icon name={icon} /> : icon}
    >
      {iconOnly ? null : children}
    </AntButton>
  );
  return iconOnly ? <Tooltip title={title || label} trigger={["hover", "focus"]} mouseEnterDelay={0.35}>{button}</Tooltip> : button;
}
export function IconButton({ label, icon, ...props }) {
  return <Button {...props} iconOnly aria-label={label} icon={icon} />;
}
export function PanelHeader({ title, count, children }) {
  return (
    <div className="panel-heading">
      <h2>
        {title}
        {count !== undefined && <span>{count}</span>}
      </h2>
      <div className="panel-actions">{children}</div>
    </div>
  );
}
export function EmptyState({ title, description, children, icon = "assets", compact = false, className = "" }) {
  return (
    <div className={`empty${compact ? " empty-compact" : ""}${className ? ` ${className}` : ""}`}>
      <Icon name={icon} />
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}
export function SearchField({
  value,
  onChange,
  label = "搜索",
  placeholder = label,
}) {
  return (
    <Input
      aria-label={label}
      prefix={<Icon name="search" />}
      allowClear
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
export function FormDialog({
  title,
  close,
  children,
  className = "",
  width = 560,
}) {
  return (
    <Modal
      open
      getContainer={() => document.getElementById('dialogs')}
      transitionName=""
      maskTransitionName=""
      title={title}
      onCancel={close}
      footer={null}
      width={width}
      className={className}
      closable={{ "aria-label": `关闭${title}` }}
      destroyOnHidden
    >
      {children}
    </Modal>
  );
}
export function ToolPopover({
  label,
  children,
  icon = "more",
  className = "",
  showLabel = false,
  description,
  triggerClassName = "",
  onOpenChange,
  downward = false,
}) {
  const [open, setOpen] = useState(false);
  const trigger=useRef(null),[availableHeight,setAvailableHeight]=useState();
  useLayoutEffect(()=>{
    if(!open||!downward)return;
    let frame;
    const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const rect=trigger.current?.getBoundingClientRect();if(rect)setAvailableHeight(Math.max(0,Math.min(innerHeight*.65,innerHeight-rect.bottom-36)));});};
    measure();window.addEventListener('resize',measure);window.addEventListener('scroll',measure,true);window.addEventListener('wheel',measure,{passive:true});window.addEventListener('pointerup',measure);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true);window.removeEventListener('wheel',measure);window.removeEventListener('pointerup',measure);};
  },[open,downward]);
  useLayoutEffect(()=>{
    if(!open)return;
    const close=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);onOpenChange?.(false);}};
    window.addEventListener('keydown',close,true);
    return ()=>window.removeEventListener('keydown',close,true);
  },[open,onOpenChange]);
  return (
    <Popover
      open={open}
      onOpenChange={value=>{setOpen(value);onOpenChange?.(value);}}
      trigger="click"
      placement="bottomLeft"
      autoAdjustOverflow={!downward}
      align={downward?{overflow:{adjustX:true,adjustY:false}}:undefined}
      arrow={downward?false:undefined}
      content={
        <div
          className={`tool-popover ${className}`}
          style={downward?{maxHeight:availableHeight}:undefined}
          onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);}}}
          onClick={(e) => {
            if (
              e.target.closest("button") &&
              !e.target.closest("[data-keep-open]")
            )
              setOpen(false);
          }}
        >
          {children}
        </div>
      }
    >
      {showLabel ? <Button ref={trigger} className={triggerClassName} icon={icon} aria-label={label} aria-expanded={open}>{description ? <span className="control-copy"><strong>{label}</strong><small>{description}</small></span> : label}{description && <Icon name="collapse" className="control-chevron"/>}</Button> : <IconButton ref={trigger} className={triggerClassName} label={label} icon={icon} aria-expanded={open} />}
    </Popover>
  );
}
export { Input, Checkbox };
export const TextArea = React.forwardRef(function TextArea({value,defaultValue,onChange,onCompositionStart,onCompositionEnd,onBlur,...props},ref){
  const [draft,setDraft]=useState(value??defaultValue??''),composing=useRef(false),committed=useRef(draft);
  // Keep the IME draft local: replaying an older controlled value cancels its range.
  useEffect(()=>{if(!composing.current&&value!==undefined){setDraft(value??'');committed.current=value??'';}},[value]);
  const commit=event=>{const next=event.target.value;if(next!==committed.current){committed.current=next;onChange?.(event);}};
  return <Input.TextArea {...props} ref={ref} value={draft}
    onChange={event=>{setDraft(event.target.value);if(!composing.current&&!event.nativeEvent.isComposing)commit(event);}}
    onCompositionStart={event=>{composing.current=true;onCompositionStart?.(event);}}
    onCompositionEnd={event=>{composing.current=false;setDraft(event.target.value);commit(event);onCompositionEnd?.(event);}}
    onBlur={event=>{composing.current=false;commit(event);onBlur?.(event);}}/>;
});
