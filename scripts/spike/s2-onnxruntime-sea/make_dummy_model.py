# WP5 spike S-2: generate a tiny dummy ONNX model (y = x + 1) for load testing.
# Usage: uv run --with onnx python make_dummy_model.py
import onnx
from onnx import helper, TensorProto

x = helper.make_tensor_value_info("x", TensorProto.FLOAT, [1, 3])
y = helper.make_tensor_value_info("y", TensorProto.FLOAT, [1, 3])
b = helper.make_tensor("b", TensorProto.FLOAT, [1, 3], [1.0, 1.0, 1.0])

node = helper.make_node("Add", ["x", "b"], ["y"], name="add_const")
graph = helper.make_graph([node], "dummy_add", [x], [y], initializer=[b])
model = helper.make_model(
    graph,
    opset_imports=[helper.make_opsetid("", 17)],
    producer_name="wp5-s2-spike",
)
# Pin IR version to 8 so any ORT >= 1.10 accepts it regardless of onnx lib version.
model.ir_version = 8
onnx.checker.check_model(model)
onnx.save(model, "dummy_add.onnx")
print("saved dummy_add.onnx, ir_version=8, opset=17, y = x + [1,1,1]")
