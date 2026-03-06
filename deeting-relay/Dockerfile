FROM golang:1.21-alpine AS builder

WORKDIR /app

COPY go.mod ./

# 如果有 go.sum，可以一起复制；当前项目较简单，略过依赖预下载。

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o deeting-relay .

FROM alpine:3.19

WORKDIR /app

COPY --from=builder /app/deeting-relay /usr/local/bin/deeting-relay

ENV RELAY_HTTP_ADDR=":8080"

EXPOSE 8080

ENTRYPOINT ["deeting-relay"]

