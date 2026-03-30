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

function propagateValue(node, widgetName, widgetValue) {
    const outputIndex = node.outputs.findIndex((o) => o.name === widgetName);
    if (outputIndex === -1) {
        return;
    }

    const output = node.outputs[outputIndex];
    if (!output.links?.length) {
        return;
    }

    // The python node sends "" for "(none)", so we should do the same.
    const valueToPropagate = widgetValue === "(none)" ? "" : widgetValue;

    for (const linkId of output.links) {
        const link = app.graph.links[linkId];
        if (!link) continue;

        const targetNode = app.graph.getNodeById(link.target_id);
        if (!targetNode) continue;

        const targetInput = targetNode.inputs[link.target_slot];
        const widgetNameOnTarget = targetInput?.widget?.name;
        const targetWidget = widgetNameOnTarget ? findWidget(targetNode, widgetNameOnTarget) : undefined;
        targetWidget && applyWidgetValue(targetWidget, valueToPropagate);
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

    const widgetsToHook = ["checkpoint", "lora", "sampler", "scheduler", "steps", "cfg", "positive_prompt", "negative_prompt"];

    widgetsToHook.forEach((name) => {
        const widget = findWidget(node, name);
        if (!widget || widget.__aioWrapped) {
            return;
        }
        const original = widget.callback;
        widget.callback = function (...args) {
            original?.apply(this, args);
            updateFilenameIfAuto(node);
            propagateValue(node, name, this.value);
        };
        widget.__aioWrapped = true;
    });
}

function addRefreshButton(node) {
    if (node.widgets?.find((w) => w.name === "__aio_refresh_filename")) {
        return;
    }

    const onClick = () => {
        node.__aioFilenameManual = false;
        updateFilenameIfAuto(node);
    };

    // Custom widget type so LiteGraph hits the default: branch and calls draw().
    // Standard "button" type uses a hardcoded renderer that ignores w.draw.
    const btn = {
        name: "__aio_refresh_filename",
        type: "aio_button",
        label: "Create Filename from Input",
        options: { serialize: false },
        clicked: false,
        draw(ctx, _node, widget_width, y, H) {
            const margin = 15;
            const w = widget_width - margin * 2;
            ctx.fillStyle = this.clicked ? "#0d47a1" : "#1565c0";
            ctx.beginPath();
            ctx.roundRect(margin, y, w, H, H * 0.3);
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.font = `bold ${Math.floor(H * 0.5)}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(this.label, margin + w * 0.5, y + H * 0.5);
        },
        mouse(event, _pos, _node) {
            if (event.type === "pointerdown") {
                this.clicked = true;
                onClick();
                return true;
            }
            if (event.type === "pointerup" || event.type === "pointerleave") {
                this.clicked = false;
                return true;
            }
            return false;
        },
    };

    node.widgets = node.widgets || [];
    node.widgets.push(btn);
    const size = node.computeSize?.();
    if (size) {
        node.setSize?.([Math.max(node.size[0], size[0]), size[1]]);
    }
}

function initializeNode(node) {
    hookWidgetCallbacks(node);
    addRefreshButton(node);
    const filenameWidget = findWidget(node, "filename");
    const current = String(filenameWidget?.value ?? "").trim();
    node.__aioFilenameManual = current.length > 0;
    if (!node.__aioFilenameManual) {
        updateFilenameIfAuto(node);
    }

    // Propagate all values on initialization to ensure downstream nodes have the correct values.
    const widgetsToPropagate = ["checkpoint", "lora", "sampler", "scheduler", "steps", "cfg", "positive_prompt", "negative_prompt"];
    widgetsToPropagate.forEach((name) => {
        const widget = findWidget(node, name);
        if (widget) {
            propagateValue(node, name, widget.value);
        }
    });
}

app.registerExtension({
	name: "ComfyUI_AIOcore.Behaviors",

	setup() {
		const originalGraphToPrompt = app.graphToPrompt;

		app.graphToPrompt = async function () {
			const affectedInputs = [];
			const graph = app.graph;
			try {
				// Find all AIOCoreSettingsNode instances
				for (const node of graph.nodes) {
					if (node.type === "AIOCoreSettingsNode") {
						// For each output on our node that has links
						for (const output of node.outputs) {
							if (output.links?.length) {
								// For each link from that output
								for (const linkId of output.links) {
									const link = graph.links[linkId];
									if (link) {
										const targetNode = graph.getNodeById(link.target_id);
										const targetSlot = link.target_slot;
										// If the target input exists and is currently linked
										if (targetNode?.inputs[targetSlot]?.link != null) {
											// Store the input and its original link ID
											affectedInputs.push({
												input: targetNode.inputs[targetSlot],
												linkId: link.id,
											});
											// Temporarily set the link to null
											targetNode.inputs[targetSlot].link = null;
										}
									}
								}
							}
						}
					}
				}
				// Now, when the original function runs, it will see the inputs as unlinked
				// and will serialize the widget's value instead of the link info.
				return await originalGraphToPrompt.apply(app, arguments);
			} finally {
				// After serialization, restore the links on the inputs
				for (const item of affectedInputs) {
					item.input.link = item.linkId;
				}
			}
		};
	},

	async beforeRegisterNodeDef(nodeType, nodeData) {
		const comfyClass = nodeType?.comfyClass ?? nodeData?.name;
		if (comfyClass !== "AIOCoreSettingsNode") {
			return;
		}

		const onNodeCreated = nodeType.prototype.onNodeCreated;
		nodeType.prototype.onNodeCreated = function () {
			onNodeCreated?.apply(this, arguments);
			try {
				initializeNode(this);
			} catch (e) {
				console.error("ComfyUI_AIOcore init failed on 'onNodeCreated'", e);
			}
		};

		const onConfigure = nodeType.prototype.onConfigure;
		nodeType.prototype.onConfigure = function () {
			onConfigure?.apply(this, arguments);
			requestAnimationFrame(() => {
				try {
					initializeNode(this);
				} catch (e) {
					console.error("ComfyUI_AIOcore init failed on 'onConfigure'", e);
				}
			});
		};
	},
});
