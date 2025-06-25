## 目标
在节目表功能的基础上实现调用 ffmpeg 推流至指定 rtmp 终点并监控其状态的功能

## 简述
0. 前后端实现部分使用日语，包括注释等
1. 参照 config/config.yml 中调用 ffmpeg 观看直播的方式，编写推流指令
2. 在 config.yml 中新增 rtmp 终点配置与推流指令模板
3. 在 server 端参照下述指令，实现推流用的 API
  - 在内存中保留当前的推流进程状态，仅限一个任务
  - 若发起了别的推流请求，则停止前一个推流进程
4. 在 client 端
  - 在 OnAir.vue 每个频道被点击后的对话框中新增推流按钮
  - 点击推流按钮后弹出对话框，显示后端设置好的推流终点，并要求用户输入推流 key（在浏览器本地保存历史记录）

## 手动挡指令模板

```shell
<path to ffmpeg> -re -dual_mono_mode main -hwaccel qsv -hwaccel_output_format qsv -i  http://<mirakurun url>/api/services/<service_id>/stream -c:a libfdk_aac -ar 48000 -b:a 192k -ac 2 -c:v h264_qsv -vf 'vpp_qsv=deinterlace=2'  -f flv <rtmp endpoint>/<key>
```

## 进度状态

### ✅ 已完成
1. ✅ **配置文件和FFmpeg命令研究** - 分析了现有的流媒体配置结构和参数替换机制
2. ✅ **RTMP配置添加** - 在config.yml中添加了RTMP终点配置和推流指令模板
3. ✅ **后端RTMP推流API** - 实现了完整的RTMP推流进程管理和状态跟踪
4. ✅ **API路由和控制器** - 创建了RTMP推流的REST API接口

#### 具体实现内容：
- **配置文件**: `config/config.yml.template`中添加RTMP配置区域
- **类型定义**: 更新了API类型定义，添加RTMPEndpoint接口
- **后端模型**: `RTMPStreamModel`实现推流进程管理和状态跟踪
- **API接口**: 创建了`/api/rtmp`和`/api/rtmp/endpoints`端点
- **日志系统**: 添加了专门的RTMP日志记录器
- **依赖注入**: 完成了模型注册和依赖管理

### ✅ 最新完成
5. ✅ **前端OnAir.vue修改** - 完成推流按钮和对话框实现
6. ✅ **前端推流key管理** - 实现推流key输入和本地存储功能

#### 新增实现内容：
- **RTMPStreamDialog组件**: 完整的RTMP配信对话框，支持终点选择、密钥输入、状态监控
- **OnAirSelectStream集成**: 在频道选择对话框中添加"RTMP配信"按钮
- **本地存储**: 使用localStorage自动保存和恢复各终点的推流密钥
- **实时状态监控**: 3秒间隔轮询推流状态，显示配信进度和错误信息
- **用户体验**: 支持密钥隐藏/显示、加载状态、错误提示等完整UI交互

### ⏳ 待完成
7. ⏳ **功能测试** - 测试完整的RTMP推流功能

## to claude code
可以在本文件中管理当前的进度，并适当修正我提出的需求