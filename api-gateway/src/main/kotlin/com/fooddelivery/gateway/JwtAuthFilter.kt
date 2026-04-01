package com.fooddelivery.gateway

import io.jsonwebtoken.Claims
import io.jsonwebtoken.JwtException
import io.jsonwebtoken.Jwts
import io.jsonwebtoken.security.Keys
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.cloud.gateway.filter.GatewayFilterChain
import org.springframework.cloud.gateway.filter.GlobalFilter
import org.springframework.core.Ordered
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.web.server.ServerWebExchange
import reactor.core.publisher.Mono
import java.nio.charset.StandardCharsets

/**
 * Global JWT authentication filter for the API Gateway.
 *
 * For every inbound request:
 *  1. Extracts the `Authorization: Bearer <token>` header.
 *  2. Validates the JWT signature and expiry using the shared [jwtSecret].
 *  3. Extracts the `sub` claim (customer ID) and forwards it downstream
 *     as the `X-Customer-Id` header so services can trust it without
 *     re-parsing the token.
 *
 * Public paths listed in [PUBLIC_PATHS] bypass authentication entirely.
 */
@Component
class JwtAuthFilter(
    @Value("\${jwt.secret}") private val jwtSecret: String,
) : GlobalFilter, Ordered {

    private val log = LoggerFactory.getLogger(JwtAuthFilter::class.java)

    private val signingKey by lazy {
        Keys.hmacShaKeyFor(jwtSecret.toByteArray(StandardCharsets.UTF_8))
    }

    override fun getOrder(): Int = -100 // run before routing filters

    override fun filter(exchange: ServerWebExchange, chain: GatewayFilterChain): Mono<Void> {
        val path = exchange.request.uri.path

        if (PUBLIC_PATHS.any { path.startsWith(it) }) {
            return chain.filter(exchange)
        }

        val authHeader = exchange.request.headers.getFirst(HttpHeaders.AUTHORIZATION)
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            log.warn("Missing or malformed Authorization header for path: {}", path)
            return unauthorized(exchange)
        }

        val token = authHeader.removePrefix("Bearer ").trim()

        return try {
            val claims = validateToken(token)
            val customerId = claims.subject
                ?: return unauthorized(exchange, "JWT missing 'sub' claim")

            // Forward the verified customer ID to downstream services
            val mutatedRequest = exchange.request.mutate()
                .header("X-Customer-Id", customerId)
                .build()

            chain.filter(exchange.mutate().request(mutatedRequest).build())
        } catch (ex: JwtException) {
            log.warn("JWT validation failed for path {}: {}", path, ex.message)
            unauthorized(exchange, ex.message)
        }
    }

    private fun validateToken(token: String): Claims =
        Jwts.parser()
            .verifyWith(signingKey)
            .build()
            .parseSignedClaims(token)
            .payload

    private fun unauthorized(
        exchange: ServerWebExchange,
        reason: String? = null,
    ): Mono<Void> {
        log.debug("Rejecting request: {}", reason)
        exchange.response.statusCode = HttpStatus.UNAUTHORIZED
        return exchange.response.setComplete()
    }

    companion object {
        private val PUBLIC_PATHS = listOf(
            "/actuator/health",
            "/actuator/info",
            "/v3/api-docs",
            "/swagger-ui",
        )
    }
}
