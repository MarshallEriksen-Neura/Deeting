interface ConnectionLineProps {
  from: { x: number; y: number }
  to: { x: number; y: number }
  isActive: boolean
  isDimmed?: boolean
  isCritical?: boolean
  badge?: string
}

export function ConnectionLine({
  from,
  to,
  isActive,
  isDimmed,
  isCritical,
  badge,
}: ConnectionLineProps) {
  // 计算贝塞尔曲线路径
  const dx = to.x - from.x
  const dy = to.y - from.y

  // 控制点 - 创建平滑的曲线
  const cp1x = from.x + dx * 0.4
  const cp1y = from.y
  const cp2x = to.x - dx * 0.4
  const cp2y = to.y

  const pathData = `M ${from.x} ${from.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${to.x} ${to.y}`

  const strokeColor = isActive || isCritical ? "var(--primary)" : "var(--border)"
  const strokeWidth = isActive || isCritical ? "3" : "2"
  const badgeX = from.x + (to.x - from.x) * 0.72
  const badgeY = from.y + (to.y - from.y) * 0.72

  return (
    <g opacity={isDimmed ? 0.2 : 1}>
      {/* 主连接线 */}
      <path
        d={pathData}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        fill="none"
        className="transition-all duration-300"
      />

      {/* 数据流动效果 */}
      {isActive && (
        <circle r="4" fill="var(--primary)">
          <animateMotion
            dur="2s"
            repeatCount="indefinite"
            path={pathData}
          />
        </circle>
      )}

      {/* 箭头 */}
      <polygon
        points={`${to.x - 8},${to.y - 4} ${to.x},${to.y} ${to.x - 8},${to.y + 4}`}
        fill={strokeColor}
        className="transition-all duration-300"
      />
      {badge && (
        <g>
          <circle
            cx={badgeX}
            cy={badgeY}
            r={9}
            fill="var(--card)"
            stroke="var(--primary)"
            strokeWidth={1}
          />
          <text
            x={badgeX}
            y={badgeY}
            fontSize={9}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="var(--primary)"
            className="select-none"
          >
            {badge}
          </text>
        </g>
      )}
    </g>
  )
}
