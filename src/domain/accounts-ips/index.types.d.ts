type AccountIPs = {
  readonly id: AccountId
  lastIPs: IPType[]
}

type AccountOptIps = {
  readonly id: AccountId
  lastIPs?: IPType[]
}

type IPMetadataValidatorArgs = {
  denyIPCountries: string[]
  allowIPCountries: string[]
  denyASNs: string[]
  allowASNs: string[]
}

type IPMetadataValidator = {
  validateForReward(ipMetadata?: IPType): true | ValidationError
}

interface IAccountsIPsRepository {
  update(accountIp: AccountOptIps): Promise<true | RepositoryError>
  findById(accountId: AccountId): Promise<AccountIPs | RepositoryError>
}
