"""Exercise the actual image-analysis worker with inert local model leaves."""
import contextlib
import importlib.util
import sys
import types
import unittest
import unittest.mock
from pathlib import Path

spec = importlib.util.spec_from_file_location("qwen_image_worker", Path(__file__).parents[1] / "src/computer/qwen-vl-worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class Image:
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def convert(self, mode): return self


class Tokens:
    shape = (1, 3)
    def __getitem__(self, key): return self
    def to(self, device): return self


class Processor:
    def apply_chat_template(self, messages, **kwargs):
        self.messages = messages
        return "image task"

    def __call__(self, **kwargs): return {"input_ids": Tokens()}
    def batch_decode(self, generated, **kwargs): return [self.output]


class Model:
    def generate(self, **kwargs):
        self.options = kwargs
        return Tokens()


class ImageAnalysisTest(unittest.TestCase):
    def test_transcript_and_candidates_are_returned_without_coordinate_parsing_or_truncation(self):
        processor, model = Processor(), Model()
        processor.output = '{"transcript":"' + "任务文字" * 200 + '","candidates":[]}'
        worker._model, worker._processor = model, processor
        with unittest.mock.patch.dict(sys.modules, {"PIL": types.SimpleNamespace(Image=types.SimpleNamespace(open=lambda _: Image())), "torch": types.SimpleNamespace(inference_mode=contextlib.nullcontext)}):
            response = worker._analyze("owned-local-image", "extract tasks")
        self.assertTrue(response["ok"])
        self.assertEqual(response["text"], processor.output)
        self.assertEqual(model.options["max_new_tokens"], 4096)
        self.assertFalse(model.options["do_sample"])
        self.assertEqual(processor.messages[0]["content"][1]["text"], "extract tasks")


if __name__ == "__main__":
    unittest.main()
