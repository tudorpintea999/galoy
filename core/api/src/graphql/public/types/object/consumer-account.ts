import AccountLevel from "../../../shared/types/scalar/account-level"

import Transaction, {
  TransactionConnection,
} from "../../../shared/types/object/transaction"

import AccountLimits from "./account-limits"

import Quiz from "./quiz"

import CallbackEndpoint from "./callback-endpoint"

import { NotificationSettings } from "./notification-settings"

import { Accounts, Prices, Wallets } from "@/app"

import {
  majorToMinorUnit,
  SAT_PRICE_PRECISION_OFFSET,
  USD_PRICE_PRECISION_OFFSET,
} from "@/domain/fiat"
import { CouldNotFindTransactionsForAccountError } from "@/domain/errors"

import { GT } from "@/graphql/index"
import { mapError } from "@/graphql/error-map"
import {
  connectionArgs,
  connectionFromPaginatedArray,
  checkedConnectionArgs,
} from "@/graphql/connections"

import Wallet from "@/graphql/shared/types/abstract/wallet"
import IAccount from "@/graphql/public/types/abstract/account"
import WalletId from "@/graphql/shared/types/scalar/wallet-id"
import RealtimePrice from "@/graphql/public/types/object/realtime-price"
import DisplayCurrency from "@/graphql/shared/types/scalar/display-currency"

import { WalletsRepository } from "@/services/mongoose"

import { listEndpoints } from "@/app/callback"
import { IInvoiceConnection } from "@/graphql/shared/types/abstract/invoice"

const ConsumerAccount = GT.Object<Account, GraphQLPublicContextAuth>({
  name: "ConsumerAccount",
  interfaces: () => [IAccount],
  isTypeOf: () => true, // TODO: improve

  fields: () => ({
    id: {
      type: GT.NonNullID,
      resolve: (source) => source.id,
    },

    callbackEndpoints: {
      type: GT.NonNullList(CallbackEndpoint),
      resolve: async (source, args, { domainAccount }) => {
        return listEndpoints(domainAccount.id)
      },
    },

    wallets: {
      type: GT.NonNullList(Wallet),
      resolve: async (source) => {
        return Wallets.listWalletsByAccountId(source.id)
      },
    },

    walletById: {
      type: GT.NonNull(Wallet),
      args: {
        walletId: {
          type: GT.NonNull(WalletId),
        },
      },
      resolve: async (source, args) => {
        const { walletId } = args
        const wallet = await Wallets.getWalletForAccountById({
          walletId,
          accountId: source.id,
        })
        if (wallet instanceof Error) {
          throw mapError(wallet)
        }
        return wallet
      },
    },

    defaultWalletId: {
      type: GT.NonNull(WalletId),
      resolve: (source) => source.defaultWalletId,
    },

    displayCurrency: {
      type: GT.NonNull(DisplayCurrency),
      resolve: (source) => source.displayCurrency,
    },

    level: {
      type: GT.NonNull(AccountLevel),
      resolve: (source) => source.level,
    },

    realtimePrice: {
      type: GT.NonNull(RealtimePrice),
      resolve: async (source) => {
        const currency = source.displayCurrency
        const btcPrice = await Prices.getCurrentSatPrice({ currency })
        if (btcPrice instanceof Error) throw mapError(btcPrice)

        const usdPrice = await Prices.getCurrentUsdCentPrice({ currency })
        if (usdPrice instanceof Error) throw mapError(usdPrice)

        const minorUnitPerSat = majorToMinorUnit({
          amount: btcPrice.price,
          displayCurrency: currency,
        })
        const minorUnitPerUsdCent = majorToMinorUnit({
          amount: usdPrice.price,
          displayCurrency: currency,
        })

        return {
          timestamp: btcPrice.timestamp,
          denominatorCurrency: currency,
          btcSatPrice: {
            base: Math.round(minorUnitPerSat * 10 ** SAT_PRICE_PRECISION_OFFSET),
            offset: SAT_PRICE_PRECISION_OFFSET,
            currencyUnit: "MINOR",
          },
          usdCentPrice: {
            base: Math.round(minorUnitPerUsdCent * 10 ** USD_PRICE_PRECISION_OFFSET),
            offset: USD_PRICE_PRECISION_OFFSET,
            currencyUnit: "MINOR",
          },
        }
      },
    },

    csvTransactions: {
      description:
        "return CSV stream, base64 encoded, of the list of transactions in the wallet",
      type: GT.NonNull(GT.String),
      args: {
        walletIds: {
          type: GT.NonNullList(WalletId),
        },
      },
      resolve: async (source) => {
        return Accounts.getCSVForAccount(source.id)
      },
    },

    limits: {
      type: GT.NonNull(AccountLimits),
      resolve: (source) => source,
    },

    quiz: {
      type: GT.NonNullList(Quiz),
      description: "List the quiz questions of the consumer account",
      resolve: (source) => source.quiz,
    },

    transactions: {
      description:
        "A list of all transactions associated with walletIds optionally passed.",
      type: TransactionConnection,
      args: {
        ...connectionArgs,
        walletIds: {
          type: GT.List(WalletId),
        },
      },
      resolve: async (source, args) => {
        const paginationArgs = checkedConnectionArgs(args)
        if (paginationArgs instanceof Error) {
          throw paginationArgs
        }

        let { walletIds } = args

        if (!walletIds) {
          const wallets = await WalletsRepository().listByAccountId(source.id)
          if (wallets instanceof Error) {
            throw mapError(wallets)
          }
          walletIds = wallets.map((wallet) => wallet.id)
        }

        const { result, error } = await Accounts.getTransactionsForAccountByWalletIds({
          account: source,
          walletIds,
          paginationArgs,
        })

        if (error instanceof Error) {
          throw mapError(error)
        }

        if (!result?.slice) {
          const nullError = new CouldNotFindTransactionsForAccountError()
          throw mapError(nullError)
        }

        return connectionFromPaginatedArray<WalletTransaction>(
          result.slice,
          result.total,
          paginationArgs,
        )
      },
    },
    pendingTransactions: {
      type: GT.NonNullList(Transaction),
      args: {
        walletIds: {
          type: GT.List(WalletId),
        },
      },
      resolve: async (source, args) => {
        const { walletIds } = args

        const transactions =
          await Accounts.getPendingOnChainTransactionsForAccountByWalletIds({
            account: source,
            walletIds,
          })

        if (transactions instanceof Error) {
          throw mapError(transactions)
        }
        return transactions
      },
    },

    invoices: {
      description: "A list of all invoices associated with walletIds optionally passed.",
      type: IInvoiceConnection,
      args: {
        ...connectionArgs,
        walletIds: {
          type: GT.List(WalletId),
        },
      },
      resolve: async (source, args) => {
        const { walletIds } = args

        const result = await Accounts.getInvoicesForAccountByWalletIds({
          account: source,
          walletIds,
          rawPaginationArgs: args,
        })

        if (result instanceof Error) {
          throw mapError(result)
        }

        return result
      },
    },
    notificationSettings: {
      type: GT.NonNull(NotificationSettings),
      resolve: (source) => source.notificationSettings,
    },
  }),
})

export default ConsumerAccount
