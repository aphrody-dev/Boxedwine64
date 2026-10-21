// SPDX-License-Identifier: GPL-2.0-or-later
import { createVk64Backend } from "./vk64-browser.js";

/** Initialize the pinned shared backend before enabling guest Vulkan traffic. */
export async function createBrowserVulkanBackend({
  artifactBase,
  canvas,
  onPresentedFrame,
}) {
  const base = new URL(artifactBase, location.href);
  if (base.origin !== location.origin || base.username || base.password)
    throw Error("The Vulkan runtime artifacts must be same-origin");
  if (!navigator.gpu) throw Error("WebGPU is unavailable");
  const [binding, adapterModule, pluginModule, bridgeModule] =
    await Promise.all([
      import(new URL("pkg/gpu.js", base).href),
      import(new URL("adapter.js", base).href),
      import(new URL("webx/harness/vkwebgpu-plugin.mjs", base).href),
      import(new URL("webx/harness/vk-bridge.mjs", base).href),
    ]);
  await binding.default();
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw Error("No WebGPU adapter available");
  const device = await adapter.requestDevice();
  let plugin, backend;
  const lost = new AbortController();
  try {
    plugin = await pluginModule.loadPlugin({
      shaderTranslator: adapterModule.createWebXShaderTranslator(binding),
      capturePresentedFrames: typeof onPresentedFrame === "function",
    });
    device.pushErrorScope("validation");
    await plugin.initialize(adapter, device, canvas);
    const initializationError = await device.popErrorScope();
    if (initializationError) throw Error(initializationError.message);
    const bridge = new bridgeModule.VkBridge(plugin);
    backend = createVk64Backend(
      {
        async processPacket(packet) {
          device.pushErrorScope("validation");
          let response;
          try {
            response = await bridge.processPacket(packet);
            const requestView = new DataView(
              packet.buffer,
              packet.byteOffset,
              packet.byteLength,
            );
            const responseView = new DataView(
              response.buffer,
              response.byteOffset,
              response.byteLength,
            );
            if (
              requestView.getUint32(4, true) === 0x24 &&
              responseView.getInt32(4, true) === 0 &&
              onPresentedFrame
            )
              await onPresentedFrame(await plugin.readbackPresentedFrame());
          } catch (error) {
            await device.popErrorScope();
            throw error;
          }
          const validationError = await device.popErrorScope();
          if (validationError) throw Error(validationError.message);
          if (lost.signal.aborted) throw Error("WebGPU device lost");
          return response;
        },
      },
      () => {
        lost.abort();
        plugin.destroy();
        device.destroy();
      },
    );
    device.addEventListener("uncapturederror", () => backend.close(), {
      signal: lost.signal,
    });
    device.lost.then(() => backend.close());
    return backend;
  } catch (error) {
    plugin?.destroy();
    device.destroy();
    throw error;
  }
}
