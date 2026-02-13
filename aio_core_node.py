import os

import folder_paths
from comfy.samplers import KSampler


def _with_none_option(items):
    return ["(none)"] + list(items)


def _strip_extension(filename):
    return os.path.splitext(filename)[0]


def _pathless_stem(value):
    # Keep only the filename part (drop folders), then remove extension.
    leaf = str(value).replace("\\", "/").split("/")[-1]
    return _strip_extension(leaf)


class AIOCoreSettingsNode:
    @classmethod
    def INPUT_TYPES(cls):
        checkpoints = _with_none_option(folder_paths.get_filename_list("checkpoints"))
        loras = _with_none_option(folder_paths.get_filename_list("loras"))
        samplers = _with_none_option(KSampler.SAMPLERS)
        schedulers = _with_none_option(KSampler.SCHEDULERS)

        return {
            "required": {
                "checkpoint": (checkpoints,),
                "lora": (loras,),
                "positive_prompt": ("STRING", {"default": "", "multiline": True}),
                "negative_prompt": ("STRING", {"default": "", "multiline": True}),
                "sampler": (samplers,),
                "scheduler": (schedulers,),
                "steps": ("INT", {"default": 20, "min": 1, "max": 10000, "step": 1}),
                "cfg": ("FLOAT", {"default": 7.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                "filename": ("STRING", {"default": "", "multiline": False}),
            }
        }

    RETURN_TYPES = ("*", "*", "STRING", "STRING", "*", "*", "INT", "FLOAT", "STRING")
    RETURN_NAMES = ("checkpoint", "lora", "positive_prompt", "negative_prompt", "sampler", "scheduler", "steps", "cfg", "filename")
    FUNCTION = "collect"
    CATEGORY = "AIO Core"

    def collect(self, checkpoint, lora, positive_prompt, negative_prompt, sampler, scheduler, steps, cfg, filename):
        checkpoint_value = "" if checkpoint == "(none)" else checkpoint
        lora_value = "" if lora == "(none)" else lora
        sampler_value = "" if sampler == "(none)" else sampler
        scheduler_value = "" if scheduler == "(none)" else scheduler

        filename_text = filename if isinstance(filename, str) else ""
        final_filename = filename_text.strip()
        if not final_filename:
            parts = []
            if checkpoint_value:
                parts.append(_pathless_stem(checkpoint_value))
            if lora_value:
                parts.append(_pathless_stem(lora_value))
            if sampler_value:
                parts.append(sampler_value)

            if parts:
                final_filename = "_".join(parts) + "_"
            else:
                final_filename = "ComfyUI_"
        if not final_filename:
            final_filename = "ComfyUI_"

        return (
            checkpoint_value,
            lora_value,
            positive_prompt,
            negative_prompt,
            sampler_value,
            scheduler_value,
            steps,
            cfg,
            final_filename,
        )


NODE_CLASS_MAPPINGS = {
    "AIOCoreSettingsNode": AIOCoreSettingsNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AIOCoreSettingsNode": "AIO Core Settings",
}
