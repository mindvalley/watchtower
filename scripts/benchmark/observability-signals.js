// scripts/benchmark/observability-signals.js
'use strict';

// Detection signals for C4 observability readiness, per stack × pillar.
// deps  — library names to match in the manifest (declared rung)
// config — regexes to match in config files (configured rung)
// usage  — regexes to match in source files (exercised rung)
// Approximate by design; validated against real repos before publish and
// tuned there. Adding a library = edit a list here, no logic change.

module.exports = {
  elixir: {
    logging: {
      deps: ['logger_json', 'ink', 'logfmt'],
      config: [/LoggerJSON/, /:logger_json/, /format:\s*\{/, /metadata:\s*\[/],
      usage: [/\bLogger\.(debug|info|warn|warning|error)\b/],
    },
    tracing: {
      deps: ['opentelemetry', 'opentelemetry_api', 'mv_opentelemetry', 'spandex', 'tapper'],
      config: [/:opentelemetry/, /otlp/i, /MvOpentelemetry/, /:spandex/],
      usage: [/OpenTelemetry|OpenTelemetry\.Tracer|MvOpentelemetry|Spandex/],
    },
    errors: {
      deps: ['sentry', 'appsignal', 'rollbax', 'honeybadger'],
      config: [/:sentry|dsn:/i, /:appsignal/, /:rollbax/, /:honeybadger/],
      usage: [/Sentry\.(capture|set_context)|Appsignal\.|Rollbax\.|PlugCapture/],
    },
  },
  ruby: {
    logging: {
      deps: ['lograge', 'semantic_logger', 'ougai'],
      config: [/lograge/i, /SemanticLogger/, /Ougai/],
      usage: [/lograge|SemanticLogger|Rails\.logger/],
    },
    tracing: {
      deps: ['opentelemetry-sdk', 'opentelemetry-instrumentation-all', 'ddtrace'],
      config: [/OpenTelemetry|Datadog|ddtrace/],
      usage: [/OpenTelemetry|Datadog::Tracing|Tracer/],
    },
    errors: {
      deps: ['sentry-ruby', 'sentry-rails', 'rollbar', 'bugsnag', 'honeybadger', 'appsignal'],
      // AppSignal configures via config/appsignal.yml (lowercase keys, no "Appsignal"
      // string) — match its push_api_key marker as well as the initializer patterns.
      config: [/Sentry\.init|Rollbar\.configure|Bugsnag\.configure|Honeybadger|Appsignal|push_api_key/],
      // AppSignal auto-instruments Rails (config in config/appsignal.yml, few explicit
      // calls), so match its namespace as well as the classic explicit trackers.
      usage: [/Sentry\.capture|Rollbar\.|Bugsnag\.|Honeybadger\.notify|Appsignal[.:]/],
    },
  },
  js: {
    logging: {
      deps: ['pino', 'pino-http', 'pino-pretty', 'nestjs-pino', 'winston', 'bunyan'],
      // config markers are library-specific only. `createLogger(` is generic (any
      // hand-rolled console wrapper has it) so it lives in `usage`, where the
      // exercised-requires-declared gate protects it — it must NOT sit here or a
      // custom createLogger in a config file would forge a rung-2/3 score.
      config: [/nestjs-pino|LoggerModule/, /new winston/],
      // Anchored to library fingerprints, not a bare logger.info (any console
      // wrapper has that -> false green).
      usage: [/\bpino\(/, /PinoLogger/, /nestjs-pino/, /createLogger\(/, /\bLoggerModule\b/],
    },
    tracing: {
      deps: ['@opentelemetry/api', '@opentelemetry/sdk', '@vercel/otel', 'dd-trace',
        'langfuse', 'langsmith', '@arizeai/openinference'],
      config: [/registerOTel|@vercel\/otel/, /NodeSDK|BasicTracerProvider/, /LANGFUSE_|LANGSMITH_|LANGCHAIN_TRACING/],
      usage: [/registerOTel|@vercel\/otel/, /trace\.getTracer/, /\bLangfuse\(/, /CallbackHandler/,
        /langsmith|LangSmith/, /openinference|OpenInference/],
    },
    errors: {
      deps: ['@sentry/node', '@sentry/nextjs', '@sentry/bun', 'rollbar', '@bugsnag/js', 'bugsnag'],
      config: [/Sentry\.init\(/, /new Rollbar\(/, /Bugsnag\.start\(/],
      usage: [/captureException|Sentry\.capture/, /Rollbar\.(error|warning|critical)/, /Bugsnag\.notify/],
    },
  },
  python: {
    logging: {
      deps: ['structlog', 'loguru', 'python-json-logger'],
      config: [/structlog\.configure/, /logging\.config\.(dictConfig|fileConfig)/, /loguru/],
      // Structured-logger fingerprints only; bare stdlib logging.getLogger is not
      // "structured logging" and must not count.
      usage: [/structlog\.(get_logger|configure)/, /from loguru/, /loguru\.logger/],
    },
    tracing: {
      deps: ['opentelemetry', 'opentelemetry-sdk', 'opentelemetry-instrumentation',
        'ddtrace', 'langfuse', 'langsmith', 'openinference-instrumentation', 'openinference'],
      config: [/TracerProvider|set_tracer_provider/, /OTEL_|otlp/i, /LANGFUSE_|LANGSMITH_|LANGCHAIN_TRACING/],
      usage: [/\bLangfuse\(|langfuse/, /CallbackHandler/, /langsmith|LangSmith/,
        /trace\.get_tracer/, /openinference|OpenInference/, /@observe\b/],
    },
    errors: {
      deps: ['sentry-sdk', 'rollbar', 'bugsnag', 'honeybadger'],
      config: [/sentry_sdk\.init/, /rollbar\.init|ROLLBAR/, /Bugsnag\.configure/],
      usage: [/sentry_sdk\.(capture|init)/, /capture_exception/, /rollbar\.(report|error)/, /\bbugsnag\./],
    },
  },
  frontend: {
    errors: {
      deps: ['@sentry/vue', '@sentry/browser', '@sentry/react', '@bugsnag/js', 'bugsnag', 'rollbar'],
      config: [/Sentry\.init\(/, /Bugsnag\.start\(/, /Rollbar\(/],
      // Real error-tracker call sites only. A bare Vue `app.config.errorHandler`
      // is error HANDLING, not error TRACKING — excluded to avoid false greens on
      // systems with no reporting library (Sentry.init-with-app still counts as it
      // IS the Vue integration).
      usage: [/Sentry\.init\([^)]*[Aa]pp|captureException|Bugsnag\.notify|Rollbar\.(error|warning|critical|log)/],
    },
    frameworks: ['vue', '@vue/runtime-core', 'react', 'nuxt'],
  },
};
