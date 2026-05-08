import amqp from 'amqplib'
import express from 'express'

const AMQP_URL  = process.env.AMQP_URL  ?? 'amqp://guest:guest@localhost:5672/'
const LOKI_URL  = process.env.LOKI_URL  ?? 'http://localhost:3100'
const HTTP_PORT = process.env.PORT      ?? '3020'

const TASK_EXCHANGE       = 'task.events'
const ONBOARDING_EXCHANGE = 'onboarding.events'
const QUEUE_AUDIT_TASK    = 'audit.task.events'
const QUEUE_AUDIT_USER    = 'audit.user.events'

interface RabbitMessage {
  type: string
  payload: unknown
}

async function pushToLoki(eventType: string, payload: unknown): Promise<void> {
  const line = JSON.stringify({ event_type: eventType, payload })
  const body = {
    streams: [{
      stream: { service: 'audit1', event_type: eventType },
      values: [[`${Date.now() * 1_000_000}`, line]],
    }],
  }
  const res = await fetch(`${LOKI_URL}/loki/api/v1/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`loki push failed: ${res.status}`)
  }
}

async function subscribe(
  ch: amqp.Channel,
  exchange: string,
  queue: string,
): Promise<void> {
  await ch.assertExchange(exchange, 'fanout', { durable: true })
  await ch.assertQueue(queue, { durable: true })
  await ch.bindQueue(queue, exchange, '')
  await ch.consume(queue, async (msg) => {
    if (!msg) return
    try {
      const { type, payload } = JSON.parse(msg.content.toString()) as RabbitMessage
      console.log(`audit1: received event type=${type}`)
      await pushToLoki(type, payload)
      ch.ack(msg)
    } catch (err) {
      console.error('audit1: handler error', err)
      ch.nack(msg, false, false)
    }
  })
}

async function main(): Promise<void> {
  const conn = await amqp.connect(AMQP_URL)
  const ch   = await conn.createChannel()

  await subscribe(ch, TASK_EXCHANGE,       QUEUE_AUDIT_TASK)
  await subscribe(ch, ONBOARDING_EXCHANGE, QUEUE_AUDIT_USER)

  console.log(`audit1: listening on ${TASK_EXCHANGE}, ${ONBOARDING_EXCHANGE}`)

  const app = express()

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'audit1' })
  })

  app.listen(HTTP_PORT, () => {
    console.log(`audit1: HTTP listening on :${HTTP_PORT}`)
  })

  process.on('SIGINT',  () => { conn.close(); process.exit(0) })
  process.on('SIGTERM', () => { conn.close(); process.exit(0) })
}

main().catch((err) => { console.error(err); process.exit(1) })
