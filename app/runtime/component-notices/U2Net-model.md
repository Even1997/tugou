# U²-NetP model and adapter attribution

- Original U²-Net project: https://github.com/xuebinqin/U-2-Net/tree/ac7e1c817ecab7c7dff5ce6b1abba61cd213ff29
- Original authors: Xuebin Qin, Zichen Zhang, Chenyang Huang, Masood Dehghan, Osmar R. Zaiane, Martin Jagersand. U²-Net, Pattern Recognition 2020.
- Upstream project provides pretrained u2netp weights with its Apache-2.0 licensed project. Apache-2.0 text accompanies this file as U2Net-APACHE.txt.
- ONNX conversion distributed by rembg: https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx
- Model bytes: 4,574,861. SHA256: 309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8
- Verified against rembg's published MD5: 8e83ca70e441ab06c318d82300c84806.
- Preprocessing/postprocessing adapted from rembg sessions/base.py and sessions/u2netp.py at c5b48b0417a0254df7d461efa14573597f369a83. MIT text accompanies this file as rembg-MIT.txt.
- This optional local runtime does not install rembg or PyTorch. It uses the existing ONNX Runtime/Pillow/NumPy environment. Models are downloaded on installation, not bundled in the application installer.
- U²-NetP is salient-object segmentation, not precision hair/veil matting. Users should inspect edges and retain the original image.
