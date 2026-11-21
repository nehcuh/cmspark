# #878 microphone onset and transcription timings

Measured on Windows 11 with Chromium 143.0.7499.4 (Playwright 1.57), Intel Core i9-14900KF and whisper.cpp v1.7.6. Chrome ran the built extension in disposable profiles and acquired a deterministic public WAV through its microphone test device. The companion used a separate data directory and loopback ports. All transcripts in this report came from real inference.

## Materials and clock

- The AMI ES2002a mix-headset clip begins at 50.40 s. Speaker B says “Okay” at 50.42 s and “Right” at 53.56 s. The file includes the audio through 54.20 s and trailing digital silence. SHA-256 of the playback WAV is `9da9fc862a6db1455f4ca7c8c6cfa9491d2fa212e361b0cdf68f0c43c54b83b4`. [AMI manual annotations](https://groups.inf.ed.ac.uk/ami/AMICorpusAnnotations/ami_public_manual_1.6.2.zip)
- The 5.156 s Mandarin source begins speaking in its first 8 ms. Its reference begins with 重点 and ends with 表现. Chrome played it with added silence and stopped after the spoken sentence. The source WAV SHA-256 is `d1a6d1f1a9eff2d8afea3f043bfe0a317a0ce4c4e36df1795781c83c95911bbe`. [Recording](https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-2023-03-28/resolve/main/test_wavs/1.wav) · [Reference](https://k2-fsa.github.io/sherpa/onnx/python/decode-files.html)
- Seconds in the first five measurement columns are relative to the start-button click. Device marks resolution of the browser microphone promise. First PCM and Audible are observed on a parallel muted monitor of the same stream. The audible threshold is an absolute Float32 amplitude above 0.002. Submit marks the first outgoing PCM block. First text samples the actual transcript editor or chat input every 10 ms. Stop → final ends at the terminal ASR event.
- Cold means a fresh Chrome profile and first microphone use. Warm means a fresh page and another capture in that profile. CPU servers stayed up, the local CLI started a new process for every recognition, and OS caches were retained. Different processing loads affect these runs. A model's first caption must be visible within three seconds of the first audible sample to meet the timing target.

## Live meeting

The first batch can close after one second when speech has been followed by 320 ms of quiet. After 1.6 s a 160 ms quiet gap is sufficient. The hard first-batch ceiling is 2.56 s, or the configured provider limit for shorter batches. Subsequent batches retain the configured provider limit up to eight seconds. The last partial batch drains on Stop. Unit tests concatenate outgoing PCM and check every sample through the final block for a quiet pause, continuous speech and pure silence.

### Local large-v3-turbo on CPU

The shipping CLI uses full acoustic context, up to six CPU threads and a new process for each segment. It recovered both annotated words in all six 1.6 s window trials. The three-second timing target failed on every run. Concurrent CPU work affected the matrix below. Three separate earlier starts with less contention showed first text about 12.6 s after microphone readiness.

| Take | Device | First PCM | Submit | Audible | First text | Onset → text | Stop → final |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 cold | 0.323 | 0.341 | 0.375 | 0.386 | 18.492 | 18.107 | 24.564 |
| 1 warm | 0.163 | 0.169 | 0.212 | 0.222 | 14.892 | 14.670 | 31.198 |
| 2 cold | 0.318 | 0.336 | 0.372 | 0.399 | 20.430 | 20.031 | 29.876 |
| 2 warm | 0.184 | 0.189 | 0.228 | 0.239 | 16.945 | 16.706 | 27.315 |
| 3 cold | 0.230 | 0.235 | 0.276 | 0.286 | 20.632 | 20.346 | 30.869 |
| 3 warm | 0.185 | 0.191 | 0.230 | 0.240 | 16.861 | 16.620 | 27.011 |

A paired 8.8 s capture used the same recording, model and language with two entry contracts on the candidate build. The retained legacy eight-second window took 19.036 s from audible onset to text and 21.156 s from Stop to final. With the new pause boundary it took 12.193 s and 14.511 s. The legacy path also hallucinated “you” on its near-silent tail. The new run produced “Okay. Right.” The underlying full-context model takes approximately one second to load and nine to eleven seconds to encode a short prefix. CPU flash attention still took about twelve seconds on held-out speech. Reducing acoustic context to 128 or 256 repeated words. At 512 the model heard “Rice” for “Right”. The shipped CLI retains its full context.

### External CPU small

The loopback OpenAI-compatible whisper-server used the multilingual small model, six CPU threads, and an administrator-selected 512-token acoustic context. With a fixed 1.6 s first window it recovered both annotated words six times; onset → first text was 2.857, 2.788, 2.399, 3.134, 2.452 and 2.998 seconds. With the new pause boundary it still recovered both words in every run.

| Take | Device | First PCM | Submit | Audible | First text | Onset → text | Stop → final |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 cold | 0.337 | 0.353 | 0.390 | 0.401 | 2.199 | 1.798 | 0.934 |
| 1 warm | 0.285 | 0.298 | 0.338 | 0.358 | 1.969 | 1.611 | 0.664 |
| 2 cold | 0.315 | 0.321 | 0.362 | 0.372 | 1.958 | 1.585 | 0.754 |
| 2 warm | 0.258 | 0.264 | 0.302 | 0.332 | 1.898 | 1.566 | 0.725 |
| 3 cold | 0.317 | 0.323 | 0.362 | 0.372 | 2.060 | 1.688 | 0.787 |
| 3 warm | 0.262 | 0.275 | 0.311 | 0.332 | 2.000 | 1.667 | 0.859 |

The held-out public utterance from 55.98–60.35 s contains “Um, well, this is the kick-off meeting for our, our project”. Native large retained the main phrase and omitted the disfluencies. The external small service returned “Okay” even for a direct unsplit upload of this held-out recording. The six successful short-utterance runs establish the first/last words of that particular fixture only.

The tiny.en loopback model produced first text in 2.00–2.24 s and decoded the second annotated word as “Nice” in all six runs. Some responses included a separate `[BLANK_AUDIO]` line. The live handler now treats an explicit blank line or empty recognised pause as silence while preserving words on other lines. A separately tested full-context base.en CPU service also misheard the second word.

## Chat dictation

The local small model was selected in the disposable environment. Under the existing Chinese dictation default the English fixture produced “OK” in all six runs, with first text in 3.55–4.42 s. Capturing the exact PCM sent by chat and decoding it with the same CLI yielded “Okay. Right.” in English and “OK” in Chinese. Both sounds reached the recognizer. The Mandarin matrix below uses the matching language. Six runs preserved the last word 表现. Five recovered the opening 重点, and one warm run produced 动点. Two otherwise-correct openings substituted 的 for the reference filler 呢. Three runs first showed text only after stop.

| Take | Device | First PCM | Submit | Audible | First text | Onset → text | Stop → final |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 cold | 0.238 | 0.251 | 0.279 | 0.278 | 11.873 | 11.595 | 5.873 |
| 1 warm | 0.188 | 0.202 | 0.229 | 0.235 | 11.655 | 11.420 | 5.702 |
| 2 cold | 0.215 | 0.222 | 0.267 | 0.266 | 11.823 | 11.556 | 5.820 |
| 2 warm | 0.180 | 0.192 | 0.225 | 0.224 | 5.894 | 5.670 | 4.165 |
| 3 cold | 0.215 | 0.228 | 0.255 | 0.268 | 4.054 | 3.786 | 2.944 |
| 3 warm | 0.156 | 0.162 | 0.204 | 0.193 | 3.903 | 3.710 | 2.750 |

The startup regression tests inject recognisable sample sequences at the first capture callback, delay the handshake by 500 ms and 1500 ms, and compare the exact PCM sent. They also exercise two-second overflow, cancellation before a delayed ACK and unordered credits. These tests isolate dropped or repeated bytes independently of model accuracy.

## External CUDA large-v3-turbo

The optional loopback OpenAI-compatible service ran the upstream v1.7.6 CUDA 12.4 binary and large-v3-turbo with full acoustic context, six CPU threads and previous-text context disabled. NVIDIA runtime logs confirmed the model used CUDA0 on an RTX 4080 SUPER. Each cold run started a new service process before the first take. The browser retained the same WAV for the warm take. The final six recordings recovered Okay and Right. Service launch to listening took 1.530, 1.524 and 1.541 s before the three fresh-profile takes. An earlier fresh-service matrix on this host recorded a slowest onset-to-caption of 2.715 s and occasionally placed a question mark after Right. [Official CUDA binary](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.7.6)

| Take | Device | First PCM | Submit | Audible | First text | Onset → text | Stop → final |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 cold | 0.313 | 0.319 | 0.359 | 0.370 | 1.527 | 1.158 | 0.226 |
| 1 warm | 0.262 | 0.268 | 0.307 | 0.317 | 1.406 | 1.089 | 0.220 |
| 2 cold | 0.307 | 0.313 | 0.353 | 0.363 | 1.516 | 1.153 | 0.221 |
| 2 warm | 0.266 | 0.272 | 0.310 | 0.320 | 1.409 | 1.089 | 0.219 |
| 3 cold | 0.322 | 0.327 | 0.368 | 0.378 | 1.528 | 1.150 | 0.195 |
| 3 warm | 0.260 | 0.266 | 0.304 | 0.315 | 1.405 | 1.090 | 0.209 |

A separate held-out CUDA recording isolated an opening-batch boundary inside the annotated word ‘meeting’. The old 1.6 s cut produced ‘Well this is to kick off / for our project’. A direct upload of the full phrase produced ‘This is the kick-off meeting for our project’. Waiting for the 160 ms quiet gap closed the opening batch at 2.52 s. Two Chrome runs then produced ‘Well, this is a kick-off meeting for our / or project’ with first text at 2.639 and 2.638 s. Both preserve ‘meeting’ and the ending ‘project’. The model still changed the repeated ‘our’ and dropped the initial hesitation.

## Chat with English selected

Each fresh profile selected English (US) using the visible chat dictation language selector. The audio frame declared English. All six local small runs preserved the two spoken words. The CPU first-text timings remain above three seconds.

| Take | Device | First PCM | Submit | Audible | First text | Onset → text | Stop → final |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 cold | 0.163 | 0.169 | 0.206 | 0.217 | 4.384 | 4.167 | 2.476 |
| 1 warm | 0.140 | 0.152 | 0.183 | 0.204 | 3.994 | 3.789 | 2.449 |
| 2 cold | 0.171 | 0.176 | 0.213 | 0.224 | 3.962 | 3.738 | 2.375 |
| 2 warm | 0.139 | 0.150 | 0.192 | 0.198 | 4.033 | 3.836 | 2.271 |
| 3 cold | 0.231 | 0.237 | 0.277 | 0.288 | 3.952 | 3.664 | 2.438 |
| 3 warm | 0.139 | 0.155 | 0.183 | 0.204 | 3.855 | 3.651 | 2.356 |

## Saved record navigation

In the production workbench, delayed the first saved-meeting reply by 1.4 s and selected a second item through Today. The second record stayed visible after the late reply. An attempt to switch away from edited text preserved the draft. Saving and selecting the previously blocked item again loaded the correct record. Creating a new meeting then cleared the previous transcript.

## Saved DeepSeek meeting service

On 22 November 2026, the installed meeting preference selected DeepSeek’s default ASR endpoint. Each take used the public AMI clip and a fresh confirmation in the built extension. An isolated companion read the existing meeting receiver in memory and kept the test meetings in disposable storage. The first cold profile was retired after its take. Profiles B and C were reused for the warm takes. Provider-side cache state was unknown. [DeepSeek speech-to-text API](https://api-docs.deepseek.com/guides/asr/)

All six transcripts contained both words in order, “Okay. Right.” The twelve audio requests returned HTTP 200. The service returns complete batches, and the browser displayed the first batch while capture continued. Request durations below include the HTTP round trip through response headers.

| Chrome profile / take | Device | First PCM | Submit | Audible | First text | Onset → text | Stop → final | HTTP first / tail |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A cold | 0.356 | 0.361 | 0.403 | 0.413 | 2.108 | 1.695 | 0.764 | 0.704 / 0.669 |
| B cold | 0.316 | 0.321 | 0.362 | 0.372 | 1.998 | 1.626 | 0.823 | 0.638 / 0.714 |
| B warm 1 | 0.276 | 0.288 | 0.326 | 0.336 | 1.836 | 1.499 | 0.746 | 0.512 / 0.654 |
| B warm 2 | 0.267 | 0.273 | 0.311 | 0.322 | 1.958 | 1.636 | 0.720 | 0.644 / 0.622 |
| C cold | 0.320 | 0.335 | 0.373 | 0.373 | 1.871 | 1.498 | 0.835 | 0.495 / 0.726 |
| C warm | 0.270 | 0.276 | 0.315 | 0.345 | 1.896 | 1.551 | 0.711 | 0.579 / 0.604 |
