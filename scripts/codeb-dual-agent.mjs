#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const DEFAULT_TARGET_SCORE = 90
const DEFAULT_MAX_ITERATIONS = 30
const DEFAULT_IMAGE_MODEL = 'pro'
const DEFAULT_ASPECT_RATIO = '1:1'
const DEFAULT_MAKER_MODEL = 'openai'
const DEFAULT_EVALUATOR_MODEL = 'gemini-3-pro-preview'
const DEFAULT_REPORT_ROOT = 'assets/reports/codeb-dual-agent'
const DEFAULT_MAKER_TIMEOUT_SEC = 180
const DEFAULT_GENERATION_TIMEOUT_SEC = 900
const DEFAULT_EVALUATION_TIMEOUT_SEC = 600

class UsageError extends Error {}

function printUsage() {
  console.log(`
Usage:
  node scripts/codeb-dual-agent.mjs \\
    --brief "원하는 리소스 설명" \\
    --style "원하는 풍/스타일 설명" \\
    --asset-name "hero-runner" \\
    --output-dir "assets/images/generated"

Required:
  --brief            생성 목표 설명 (무엇을 만들어야 하는지)
  --style            스타일/풍 설명 (예: 픽셀아트, 레트로, 카툰)
  --asset-name       결과 파일 prefix
  --output-dir       이미지 산출 폴더

Optional:
  --target-score     종료 기준 점수 (0-100, 기본 ${DEFAULT_TARGET_SCORE})
  --max-iterations   최대 반복 횟수 (기본 ${DEFAULT_MAX_ITERATIONS})
  --aspect-ratio     codeb 종횡비 (기본 ${DEFAULT_ASPECT_RATIO})
  --image-model      codeb cg image 모델 (flash|pro, 기본 ${DEFAULT_IMAGE_MODEL})
  --maker-model      codeb chat 모델 (기본 ${DEFAULT_MAKER_MODEL})
  --evaluator-model  codeb video 모델 (기본 ${DEFAULT_EVALUATOR_MODEL})
  --maker-timeout-sec       MakerAgent 타임아웃(초, 기본 ${DEFAULT_MAKER_TIMEOUT_SEC})
  --generation-timeout-sec  이미지 생성 타임아웃(초, 기본 ${DEFAULT_GENERATION_TIMEOUT_SEC})
  --evaluation-timeout-sec  평가 타임아웃(초, 기본 ${DEFAULT_EVALUATION_TIMEOUT_SEC})
  --remove-bg        생성 후 배경 제거 플래그 전달
  --report-root      리포트 루트 디렉토리 (기본 ${DEFAULT_REPORT_ROOT})

Example:
  npm run codeb:dual-agent -- \\
    --brief "모바일 러너 게임 주인공 토끼 캐릭터, 측면 질주 포즈" \\
    --style "16bit 픽셀아트, 명확한 실루엣, 게임 UI와 톤 일치" \\
    --asset-name "runner-rabbit" \\
    --output-dir "assets/images/generated" \\
    --remove-bg
`.trim())
}

function parseArgs(argv) {
  const options = {
    targetScore: DEFAULT_TARGET_SCORE,
    maxIterations: DEFAULT_MAX_ITERATIONS,
    imageModel: DEFAULT_IMAGE_MODEL,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    makerModel: DEFAULT_MAKER_MODEL,
    evaluatorModel: DEFAULT_EVALUATOR_MODEL,
    makerTimeoutSec: DEFAULT_MAKER_TIMEOUT_SEC,
    generationTimeoutSec: DEFAULT_GENERATION_TIMEOUT_SEC,
    evaluationTimeoutSec: DEFAULT_EVALUATION_TIMEOUT_SEC,
    removeBg: false,
    reportRoot: DEFAULT_REPORT_ROOT,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') {
      options.help = true
      continue
    }
    if (token === '--remove-bg') {
      options.removeBg = true
      continue
    }
    if (!token.startsWith('--')) {
      throw new UsageError(`알 수 없는 인자: ${token}`)
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`값이 필요한 옵션입니다: ${token}`)
    }
    i += 1
    switch (token) {
      case '--brief':
        options.brief = value.trim()
        break
      case '--style':
        options.style = value.trim()
        break
      case '--asset-name':
        options.assetName = value.trim()
        break
      case '--output-dir':
        options.outputDir = value.trim()
        break
      case '--target-score':
        options.targetScore = parseInteger(value, token, 0, 100)
        break
      case '--max-iterations':
        options.maxIterations = parseInteger(value, token, 1, 50)
        break
      case '--aspect-ratio':
        options.aspectRatio = value.trim()
        break
      case '--image-model':
        options.imageModel = value.trim()
        break
      case '--maker-model':
        options.makerModel = value.trim()
        break
      case '--evaluator-model':
        options.evaluatorModel = value.trim()
        break
      case '--maker-timeout-sec':
        options.makerTimeoutSec = parseInteger(value, token, 30, 3600)
        break
      case '--generation-timeout-sec':
        options.generationTimeoutSec = parseInteger(value, token, 30, 3600)
        break
      case '--evaluation-timeout-sec':
        options.evaluationTimeoutSec = parseInteger(value, token, 30, 3600)
        break
      case '--report-root':
        options.reportRoot = value.trim()
        break
      default:
        throw new UsageError(`지원하지 않는 옵션입니다: ${token}`)
    }
  }

  if (options.help) {
    return options
  }

  if (!options.brief) {
    throw new UsageError('--brief 는 필수입니다.')
  }
  if (!options.style) {
    throw new UsageError('--style 은 필수입니다.')
  }
  if (!options.assetName) {
    throw new UsageError('--asset-name 은 필수입니다.')
  }
  if (!options.outputDir) {
    throw new UsageError('--output-dir 는 필수입니다.')
  }

  return options
}

function parseInteger(rawValue, flag, min, max) {
  const value = Number.parseInt(rawValue, 10)
  if (Number.isNaN(value)) {
    throw new UsageError(`${flag} 는 정수여야 합니다: ${rawValue}`)
  }
  if (value < min || value > max) {
    throw new UsageError(`${flag} 는 ${min}~${max} 범위여야 합니다: ${rawValue}`)
  }
  return value
}

function nowStamp() {
  const now = new Date()
  const y = now.getFullYear()
  const m = `${now.getMonth() + 1}`.padStart(2, '0')
  const d = `${now.getDate()}`.padStart(2, '0')
  const hh = `${now.getHours()}`.padStart(2, '0')
  const mm = `${now.getMinutes()}`.padStart(2, '0')
  const ss = `${now.getSeconds()}`.padStart(2, '0')
  return `${y}${m}${d}-${hh}${mm}${ss}`
}

function extractJsonObject(text, contextLabel) {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fencedMatch ? fencedMatch[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`${contextLabel} JSON 파싱 실패: JSON 객체를 찾지 못했습니다.`)
  }
  const jsonLike = candidate.slice(start, end + 1)
  try {
    return JSON.parse(jsonLike)
  } catch (error) {
    throw new Error(`${contextLabel} JSON 파싱 실패: ${error.message}`)
  }
}

function normalizeScore(raw, key) {
  if (typeof raw !== 'number' || Number.isNaN(raw)) {
    throw new Error(`${key} 점수가 숫자가 아닙니다.`)
  }
  if (raw < 0 || raw > 100) {
    throw new Error(`${key} 점수는 0~100 이어야 합니다. 받은 값: ${raw}`)
  }
  return Math.round(raw)
}

function parseMakerResult(rawText) {
  const parsed = extractJsonObject(rawText, 'MakerAgent')
  if (typeof parsed.prompt !== 'string' || parsed.prompt.trim() === '') {
    throw new Error('MakerAgent 응답에서 prompt를 찾지 못했습니다.')
  }
  return {
    prompt: parsed.prompt.trim(),
    changeSummary:
      typeof parsed.changeSummary === 'string' ? parsed.changeSummary.trim() : '',
  }
}

function parseEvaluatorResult(rawText) {
  const parsed = extractJsonObject(rawText, 'EvaluatorAgent')
  const result = {
    totalScore: normalizeScore(parsed.totalScore, 'totalScore'),
    completionScore: normalizeScore(parsed.completionScore, 'completionScore'),
    qualityScore: normalizeScore(parsed.qualityScore, 'qualityScore'),
    styleScore: normalizeScore(parsed.styleScore, 'styleScore'),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    revisedPrompt:
      typeof parsed.revisedPrompt === 'string' ? parsed.revisedPrompt.trim() : '',
  }
  if (result.revisedPrompt.length === 0) {
    throw new Error('EvaluatorAgent 응답에서 revisedPrompt를 찾지 못했습니다.')
  }
  return result
}

function buildMakerMessage({
  brief,
  style,
  iteration,
  lastPrompt,
  lastEvaluation,
}) {
  return `
You are MakerAgent for Game Asset Generation.
Your job is to produce one improved prompt for codeb image generation.

Hard constraints:
1) Keep the core request and style.
2) Address evaluator feedback directly.
3) Make the prompt specific, production-ready, and concise.
4) Return JSON only.

Required JSON schema:
{
  "prompt": "<next generation prompt>",
  "changeSummary": "<how this prompt fixes previous issues>"
}

Context:
${JSON.stringify(
    {
      brief,
      style,
      iteration,
      lastPrompt,
      lastEvaluation,
    },
    null,
    2,
  )}
`.trim()
}

function buildEvaluatorPrompt({
  brief,
  style,
  iteration,
  generationPrompt,
  targetScore,
}) {
  return `
You are EvaluatorAgent for game resource quality review.
Evaluate the given asset on a 100-point scale.

Rubric:
- completionScore (0-100): Does it satisfy the requested subject and requirements?
- qualityScore (0-100): Is it production-quality (clarity, silhouette readability, cleanliness)?
- styleScore (0-100): Does it match the requested style/tone ("풍")?

Scoring rule:
- totalScore = round(completionScore * 0.4 + qualityScore * 0.3 + styleScore * 0.3)
- If any sub-score is below 70, totalScore must be below ${targetScore}.

Return JSON only:
{
  "totalScore": <0-100 int>,
  "completionScore": <0-100 int>,
  "qualityScore": <0-100 int>,
  "styleScore": <0-100 int>,
  "strengths": ["..."],
  "issues": ["..."],
  "revisedPrompt": "<prompt that can improve score in the next attempt>"
}

Context:
${JSON.stringify(
    {
      brief,
      style,
      iteration,
      generationPrompt,
      targetScore,
    },
    null,
    2,
  )}
`.trim()
}

async function runCommand(command, args, options = {}) {
  const { cwd = process.cwd(), timeoutMs } = options
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let timeoutId = null

    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, timeoutMs)
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      process.stdout.write(text)
    })

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      process.stderr.write(text)
    })

    child.on('error', (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      reject(error)
    })

    child.on('close', (code, signal) => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      if (timedOut) {
        reject(
          new Error(
            `명령어 타임아웃: ${command} ${args.join(' ')}\ntimeoutMs=${timeoutMs}\n${stderr}`,
          ),
        )
        return
      }
      if (code !== 0 || signal !== null) {
        const exitDetail = signal
          ? `signal=${signal}`
          : `exit code=${code}`
        reject(
          new Error(
            `명령어 실패: ${command} ${args.join(' ')}\n${exitDetail}\n${stderr}`,
          ),
        )
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function ensurePrerequisites() {
  await runCommand('codeb', ['whoami'])
  await runCommand('python3', [
    '-c',
    "import cv2, numpy; print('python-opencv-ready')",
  ])
}

async function convertImageToAvi(imagePath, aviPath) {
  const pythonScript = `
import cv2
import numpy as np
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]

img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
if img is None:
    raise RuntimeError(f"이미지를 읽을 수 없습니다: {input_path}")

if len(img.shape) == 2:
    frame = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
elif img.shape[2] == 4:
    alpha = img[:, :, 3].astype(np.float32) / 255.0
    bgr = img[:, :, :3].astype(np.float32)
    white = np.ones_like(bgr) * 255.0
    frame = (bgr * alpha[:, :, None] + white * (1.0 - alpha[:, :, None])).astype(np.uint8)
else:
    frame = img[:, :, :3]

height, width = frame.shape[:2]
if height <= 0 or width <= 0:
    raise RuntimeError("잘못된 이미지 크기입니다.")

writer = cv2.VideoWriter(output_path, cv2.VideoWriter_fourcc(*'MJPG'), 2.0, (width, height))
if not writer.isOpened():
    raise RuntimeError(f"AVI 파일을 열 수 없습니다: {output_path}")

for _ in range(4):
    writer.write(frame)

writer.release()
print(output_path)
`.trim()

  await runCommand('python3', ['-c', pythonScript, imagePath, aviPath])
}

async function runMakerAgent(params) {
  const makerMessage = buildMakerMessage(params)
  const { stdout } = await runCommand('codeb', [
    'chat',
    params.makerModel,
    makerMessage,
    '--raw',
  ], { timeoutMs: params.timeoutMs })
  return parseMakerResult(stdout)
}

async function runGeneration({
  prompt,
  outputImagePath,
  imageModel,
  aspectRatio,
  removeBg,
  timeoutMs,
}) {
  const args = ['cg', 'image', 'generate', prompt, '-o', outputImagePath]
  args.push('--model', imageModel)
  args.push('--aspect-ratio', aspectRatio)
  if (removeBg) {
    args.push('--remove-bg')
  }
  await runCommand('codeb', args, { timeoutMs })
}

async function runEvaluatorAgent({
  brief,
  style,
  iteration,
  generationPrompt,
  targetScore,
  evaluatorModel,
  inputAviPath,
  evaluationOutputPath,
  timeoutMs,
}) {
  const evaluationPrompt = buildEvaluatorPrompt({
    brief,
    style,
    iteration,
    generationPrompt,
    targetScore,
  })
  await runCommand('codeb', [
    'video',
    inputAviPath,
    '--output',
    evaluationOutputPath,
    '--prompt',
    evaluationPrompt,
    '--model',
    evaluatorModel,
    '--format',
    'json',
    '--detail',
    'standard',
  ], { timeoutMs })

  const rawEvaluation = await fs.readFile(evaluationOutputPath, 'utf8')
  return {
    parsed: parseEvaluatorResult(rawEvaluation),
    rawText: rawEvaluation,
  }
}

async function writeSessionReport(reportPath, payload) {
  await fs.writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printUsage()
    return
  }

  await ensurePrerequisites()

  const timestamp = nowStamp()
  const outputDir = path.resolve(options.outputDir)
  const reportDir = path.resolve(options.reportRoot, `${options.assetName}-${timestamp}`)

  await fs.mkdir(outputDir, { recursive: true })
  await fs.mkdir(reportDir, { recursive: true })

  const history = []
  let lastPrompt = null
  let lastEvaluation = null

  for (let iteration = 1; iteration <= options.maxIterations; iteration += 1) {
    console.log(`\n========== Iteration ${iteration}/${options.maxIterations} ==========`)

    const makerResult = await runMakerAgent({
      brief: options.brief,
      style: options.style,
      iteration,
      lastPrompt,
      lastEvaluation,
      makerModel: options.makerModel,
      timeoutMs: options.makerTimeoutSec * 1000,
    })
    lastPrompt = makerResult.prompt

    const imagePath = path.join(
      outputDir,
      `${options.assetName}-iter-${String(iteration).padStart(2, '0')}.png`,
    )
    const aviPath = path.join(
      reportDir,
      `${options.assetName}-iter-${String(iteration).padStart(2, '0')}.avi`,
    )
    const evaluationOutputPath = path.join(
      reportDir,
      `${options.assetName}-iter-${String(iteration).padStart(2, '0')}-evaluation.json`,
    )

    await runGeneration({
      prompt: makerResult.prompt,
      outputImagePath: imagePath,
      imageModel: options.imageModel,
      aspectRatio: options.aspectRatio,
      removeBg: options.removeBg,
      timeoutMs: options.generationTimeoutSec * 1000,
    })

    await convertImageToAvi(imagePath, aviPath)

    const evaluationResult = await runEvaluatorAgent({
      brief: options.brief,
      style: options.style,
      iteration,
      generationPrompt: makerResult.prompt,
      targetScore: options.targetScore,
      evaluatorModel: options.evaluatorModel,
      inputAviPath: aviPath,
      evaluationOutputPath,
      timeoutMs: options.evaluationTimeoutSec * 1000,
    })

    const evaluated = evaluationResult.parsed
    lastEvaluation = evaluated

    history.push({
      iteration,
      imagePath,
      generationPrompt: makerResult.prompt,
      makerChangeSummary: makerResult.changeSummary,
      evaluation: evaluated,
    })

    await writeSessionReport(path.join(reportDir, 'session-report.json'), {
      brief: options.brief,
      style: options.style,
      targetScore: options.targetScore,
      maxIterations: options.maxIterations,
      imageModel: options.imageModel,
      makerModel: options.makerModel,
      evaluatorModel: options.evaluatorModel,
      makerTimeoutSec: options.makerTimeoutSec,
      generationTimeoutSec: options.generationTimeoutSec,
      evaluationTimeoutSec: options.evaluationTimeoutSec,
      outputDir,
      reportDir,
      history,
    })

    console.log(
      `\n[Evaluator] total=${evaluated.totalScore} completion=${evaluated.completionScore} quality=${evaluated.qualityScore} style=${evaluated.styleScore}`,
    )

    if (evaluated.totalScore >= options.targetScore) {
      console.log('\n✅ 목표 점수 달성. 생성 루프를 종료합니다.')
      console.log(`최종 산출물: ${imagePath}`)
      console.log(`세션 리포트: ${path.join(reportDir, 'session-report.json')}`)
      return
    }

    console.log('\n점수가 목표 미만이므로 개선 루프를 계속 진행합니다.')
  }

  throw new Error(
    `최대 반복(${options.maxIterations})에 도달했지만 ${options.targetScore}점을 달성하지 못했습니다. session-report.json을 확인하세요.`,
  )
}

main().catch((error) => {
  if (error instanceof UsageError) {
    console.error(`입력 오류: ${error.message}`)
    console.error('')
    printUsage()
    process.exitCode = 2
    return
  }
  console.error(`실행 실패: ${error.message}`)
  process.exitCode = 1
})
