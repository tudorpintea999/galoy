import { ApplicationIn, Svix } from "svix"

import { SvixError, UnknownSvixError } from "./errors"

import { InvalidUrlError } from "@/domain/callback/errors"
import { parseErrorMessageFromUnknown } from "@/domain/shared"

import {
  addAttributesToCurrentSpan,
  wrapAsyncFunctionsToRunInSpan,
} from "@/services/tracing"
import { baseLogger } from "@/services/logger"

function prefixObjectKeys(
  obj: Record<string, string>,
  prefix: string,
): Record<string, string> {
  return Object.keys(obj).reduce(
    (acc, key) => {
      acc[`${prefix}${key}`] = obj[key]
      return acc
    },
    {} as Record<string, string>,
  )
}

export const CallbackService = (config: SvixConfig) => {
  if (!config.secret) {
    const nullFn = async () => {
      baseLogger.warn("CallbackService not configured")
      return
    }
    return {
      sendMessage: nullFn,
      getWebsocketPortal: nullFn,
      addEndpoint: nullFn,
      listEndpoints: nullFn,
      deleteEndpoint: nullFn,
    }
  }

  const svix = config.endpoint
    ? new Svix(config.secret, { serverUrl: config.endpoint })
    : new Svix(config.secret)

  const getAccountCallbackId = (accountId: AccountId): AccountCallbackId =>
    `account.${accountId}` as AccountCallbackId

  const createApplication = async (accountCallbackId: AccountCallbackId) => {
    try {
      const application: ApplicationIn = {
        name: accountCallbackId,
        uid: accountCallbackId,
      }

      await svix.application.create(application)
    } catch (err) {
      if ((err as SvixError).code === 409) {
        // we create app on the fly, so we are expecting this error and can ignore it
      } else {
        return handleCommonErrors(err)
      }
    }
  }

  const sendMessage = async ({
    eventType,
    accountId,
    payload,
  }: {
    eventType: string
    accountId: AccountId
    payload: Record<string, string>
  }) => {
    const accountCallbackId = getAccountCallbackId(accountId)
    addAttributesToCurrentSpan({ "callback.application": accountCallbackId })

    const res = await createApplication(accountCallbackId)
    if (res instanceof Error) return res

    try {
      const res = await svix.message.create(accountCallbackId, {
        eventType,
        payload: { ...payload, accountId, eventType },
      })

      const prefixedPayload = prefixObjectKeys(payload, "callback.payload.")
      addAttributesToCurrentSpan({
        ...prefixedPayload,
        ["callback.accountId"]: accountId,
        ["callback.eventType"]: eventType,
      })
      baseLogger.info({ res }, `message sent successfully to ${accountCallbackId}`)
      return res
    } catch (err) {
      return handleCommonErrors(err)
    }
  }

  // only work for hosted svix
  const getWebsocketPortal = async (accountId: AccountId) => {
    const accountCallbackId = getAccountCallbackId(accountId)

    const res = await createApplication(accountCallbackId)
    if (res instanceof Error) return res

    try {
      const res = await svix.authentication.appPortalAccess(accountCallbackId, {})
      return res
    } catch (err) {
      return handleCommonErrors(err)
    }
  }

  const addEndpoint = async ({
    accountId,
    url,
  }: {
    accountId: AccountId
    url: string
  }) => {
    const accountCallbackId = getAccountCallbackId(accountId)

    const res = await createApplication(accountCallbackId)
    if (res instanceof Error) return res

    try {
      const res = await svix.endpoint.create(accountCallbackId, {
        url,
      })
      return res
    } catch (err) {
      return handleCommonErrors(err)
    }
  }

  const listEndpoints = async (accountId: AccountId) => {
    const accountCallbackId = getAccountCallbackId(accountId)

    const res = await createApplication(accountCallbackId)
    if (res instanceof Error) return res

    try {
      const res = await svix.endpoint.list(accountCallbackId)
      return res.data.map((endpoint) => ({ id: endpoint.id, url: endpoint.url }))
    } catch (err) {
      return handleCommonErrors(err)
    }
  }

  const deleteEndpoint = async ({
    accountId,
    endpointId,
  }: {
    accountId: AccountId
    endpointId: string
  }) => {
    const accountCallbackId = getAccountCallbackId(accountId)

    try {
      await svix.endpoint.delete(accountCallbackId, endpointId)
      return true
    } catch (err) {
      return handleCommonErrors(err)
    }
  }

  return wrapAsyncFunctionsToRunInSpan({
    namespace: "services.callback",
    fns: { sendMessage, getWebsocketPortal, addEndpoint, listEndpoints, deleteEndpoint },
  })
}

const handleCommonErrors = (err: Error | string | unknown) => {
  const errMsg = parseErrorMessageFromUnknown(err)

  const match = (knownErrDetail: RegExp): boolean => knownErrDetail.test(errMsg)

  switch (true) {
    case match(KnownSvixErrorMessages.InvalidHttpsUrl):
      return new InvalidUrlError("URL must be https")

    default:
      return new UnknownSvixError(errMsg)
  }
}
export const KnownSvixErrorMessages = {
  InvalidHttpsUrl: /endpoint_https_only/,
} as const
