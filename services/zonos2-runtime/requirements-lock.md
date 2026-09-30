# ZONOS2 dependency lock

The runtime installs the exact upstream `uv.lock` from source commit
`194c0a3ab67b90383a67646289f28d4ecb1c1f64` with `uv==0.8.22`, then adds only
`resemble-perth==1.0.1`. This keeps Mini-SGLang, CUDA kernels, PyTorch 2.9.1,
Transformers 4.57.3 and the DAC dependency on the revisions tested together by
upstream instead of reconstructing a partial lock in this repository.

The official source requires a CUDA toolkit and JIT-compiles CUDA and NCCL
extensions at inference time. The digest-pinned runtime base is therefore supplemented
with NVIDIA package `cuda-nvcc-12-8=12.8.93-1`; its compressed package is
36,043,452 bytes. The image links only the NCCL library already pinned by the
upstream lock and fails its remote build unless NVCC 12.8, `g++` and that NCCL
library are all present. The runtime base does not carry NVIDIA's package
source, so the official 4,332 byte `cuda-keyring_1.1-1_all.deb` is admitted only
after SHA-256
`d93190d50b98ad4699ff40f4f7af50f16a76dac3bb8da1eaaf366d47898ff8df`
matches.

The source commit is immutable but unsigned. Its Git object id, official
repository, exact MIT license and every downloaded model asset are checked
before remote build. The unsigned state is reported, not hidden as a verified
signature.
