import IAccount from "../abstract/account"
import Wallet from "../../../shared/types/abstract/wallet"

import WalletId from "../../../shared/types/scalar/wallet-id"
import DisplayCurrency from "../../../shared/types/scalar/display-currency"

import AccountLevel from "../../../shared/types/scalar/account-level"

import Transaction, {
  TransactionConnection,
} from "../../../shared/types/object/transaction"

import RealtimePrice from "./realtime-price"
import { NotificationSettings } from "./notification-settings"

import { WalletsRepository } from "@/services/mongoose"

import {
  connectionArgs,
  connectionFromPaginatedArray,
  checkedConnectionArgs,
} from "@/graphql/connections"
import { GT } from "@/graphql/index"
import { mapError } from "@/graphql/error-map"
import {
  majorToMinorUnit,
  SAT_PRICE_PRECISION_OFFSET,
  USD_PRICE_PRECISION_OFFSET,
} from "@/domain/fiat"
import { CouldNotFindTransactionsForAccountError } from "@/domain/errors"
import { Accounts, Prices, Wallets } from "@/app"
import { IInvoiceConnection } from "@/graphql/shared/types/abstract/invoice"

const BusinessAccount = GT.Object({
  name: "BusinessAccount",
  interfaces: () => [IAccount],
  isTypeOf: () => false,
  fields: () => ({
    id: {
      type: GT.NonNullID,
      resolve: (source) => source.id,
    },

    wallets: {
      type: GT.NonNullList(Wallet),
      resolve: async (source: Account) => {
        return Wallets.listWalletsByAccountId(source.id)
      },
    },

    defaultWalletId: {
      type: GT.NonNull(WalletId),
      resolve: (source, args, { domainAccount }: { domainAccount: Account }) =>
        domainAccount.defaultWalletId,
    },

    level: {
      type: GT.NonNull(AccountLevel),
      resolve: (source) => source.level,
    },

    displayCurrency: {
      type: GT.NonNull(DisplayCurrency),
      resolve: (source, args, { domainAccount }: { domainAccount: Account }) =>
        domainAccount.displayCurrency,
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

export default BusinessAccount
