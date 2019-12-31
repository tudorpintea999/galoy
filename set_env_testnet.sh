# set firebase env
TLS=$(docker exec -t lnd_btc base64 /root/.lnd/tls.cert | tr -d '\n\r')
MACAROON=$(docker exec -t lnd_btc base64 /root/.lnd/data/chain/bitcoin/testnet/admin.macaroon | tr -d '\n\r')
LNDADDR="set_ip_address"
NETWORK="testnet"

firebase functions:config:set lnd.NETWORK="$NETWORK" lnd."$NETWORK".TLS="$TLS" lnd."$NETWORK".MACAROON="$MACAROON" lnd."$NETWORK".LNDADDR="$LNDADDR"