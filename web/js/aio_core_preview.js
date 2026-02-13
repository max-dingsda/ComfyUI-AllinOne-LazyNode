import { app } from "../../../scripts/app.js";

function pathlessStem(value) {
    if (!value || value === "(none)") {
        return "";
    }
    const leaf = String(value).replace(/\\/g, "/").split("/").pop() || "";
    return leaf.replace(/\.[^/.\\]+$/, "");
}

function buildAutoFilename(checkpoint, lora, sampler) {
    const parts = [];
    const checkpointStem = pathlessStem(checkpoint);
    const loraStem = pathlessStem(lora);
    const samplerValue = sampler && sampler !== "(none)" ? String(sampler) : "";

    if (checkpointStem) {
        parts.push(checkpointStem);
    }
    if (loraStem) {
        parts.push(loraStem);
    }
    if (samplerValue) {
        parts.push(samplerValue);
    }
    return parts.length ? `${parts.join("_")}_` : "ComfyUI_";
}

function findWidget(node, name) {
    return node.widgets?.find((w) => w.name === name);
}

function applyWidgetValue(widget, value) {
    widget.value = value;
    if (widget.inputEl) {
        widget.inputEl.value = value;
    }
}

function getAutoForNode(node) {
    const checkpoint = findWidget(node, "checkpoint")?.value;
    const lora = findWidget(node, "lora")?.value;
    const sampler = findWidget(node, "sampler")?.value;
    return buildAutoFilename(checkpoint, lora, sampler);
}

function updateFilenameIfAuto(node) {
    const filenameWidget = findWidget(node, "filename");
    if (!filenameWidget || node.__aioUpdatingFilename) {
        return;
    }
    if (!node.__aioFilenameManual) {
        node.__aioUpdatingFilename = true;
        applyWidgetValue(filenameWidget, getAutoForNode(node));
        node.__aioUpdatingFilename = false;
    }
}

function hookWidgetCallbacks(node) {
    const filenameWidget = findWidget(node, "filename");
    if (filenameWidget && !filenameWidget.__aioWrapped) {
        const original = filenameWidget.callback;
        filenameWidget.callback = (...args) => {
            original?.apply(filenameWidget, args);
            if (node.__aioUpdatingFilename) {
                return;
            }
            const typed = String(filenameWidget.value ?? "").trim();
            if (!typed) {
                node.__aioFilenameManual = false;
                updateFilenameIfAuto(node);
            } else {
                node.__aioFilenameManual = true;
            }
        };
        filenameWidget.__aioWrapped = true;
    }

    ["checkpoint", "lora", "sampler"].forEach((name) => {
        const widget = findWidget(node, name);
        if (!widget || widget.__aioWrapped) {
            return;
        }
        const original = widget.callback;
        widget.callback = (...args) => {
            original?.apply(widget, args);
            updateFilenameIfAuto(node);
        };
        widget.__aioWrapped = true;
    });
}

function initializeNode(node) {
    hookWidgetCallbacks(node);
    const filenameWidget = findWidget(node, "filename");
    if (!filenameWidget) {
        return;
    }
    const current = String(filenameWidget.value ?? "").trim();
    node.__aioFilenameManual = current.length > 0;
    if (!node.__aioFilenameManual) {
        updateFilenameIfAuto(node);
    }
}

app.registerExtension({
    name: "ComfyUI_AIOcore.FilenameFieldBehavior",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        const comfyClass = nodeType?.comfyClass ?? nodeData?.name;
        if (comfyClass !== "AIOCoreSettingsNode") {
            return;
        }

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
            try {
                initializeNode(this);
            } catch (e) {
                console.error("ComfyUI_AIOcore filename init failed:", e);
            }
            return result;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            requestAnimationFrame(() => {
                try {
                    initializeNode(this);
                } catch (e) {
                    console.error("ComfyUI_AIOcore filename configure failed:", e);
                }
            });
        };
    },
});
