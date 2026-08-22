# frozen_string_literal: true

require 'cgi'

module RedmineProjectExplorer
  class FlowchartSvgRenderer
    Node = Struct.new(:id, :label, :shape, keyword_init: true)
    Edge = Struct.new(:from, :to, :label, :arrow, keyword_init: true)

    def initialize(source)
      @source = source.to_s.gsub(/\r\n?/, "\n")
      @nodes = {}
      @edges = []
      @direction = 'TD'
    end

    def render
      parse!
      layout_and_render
    end

    private

    def h(value)
      CGI.escapeHTML(value.to_s)
    end

    def split_lines(text)
      text.to_s
          .split(/<br\s*\/?\s*>|\\n/i)
          .map(&:strip)
          .reject(&:empty?)
    end

    def strip_quotes(value)
      text = value.to_s.strip
      if (text.start_with?('"') && text.end_with?('"')) ||
         (text.start_with?("'") && text.end_with?("'"))
        text[1..-2]
      else
        text
      end
    end

    def parse_node_token(token)
      raw = token.to_s.strip.sub(/;$/, '')
      match = raw.match(/\A([A-Za-z0-9_.-]+)/)
      return nil unless match

      id = match[1]
      rest = raw[id.length..].to_s.strip
      return Node.new(id: id, label: id, shape: :rect) if rest.empty?

      forms = [
        [/\A\{(.*)\}\z/m, :diamond],
        [/\A\(\((.*)\)\)\z/m, :circle],
        [/\A\(\[(.*)\]\)\z/m, :stadium],
        [/\A\((.*)\)\z/m, :round],
        [/\A\[(.*)\]\z/m, :rect]
      ]

      forms.each do |pattern, shape|
        m = rest.match(pattern)
        next unless m

        return Node.new(
          id: id,
          label: strip_quotes(m[1]),
          shape: shape
        )
      end

      Node.new(
        id: id,
        label: strip_quotes(rest),
        shape: :rect
      )
    end

    def ensure_node(node)
      return nil unless node

      existing = @nodes[node.id]

      if existing
        if node.label && node.label != node.id
          existing.label = node.label
          existing.shape = node.shape
        end
        existing
      else
        @nodes[node.id] = node
      end
    end

    def parse_edge(line)
      arrow = '(?:==>|-.->|-->|---)'

      if (m = line.match(/\A(.+?)\s*(#{arrow})\s*\|([^|]+)\|\s*(.+?)\s*;?\z/))
        return [m[1], m[4], m[3].strip, m[2]]
      end

      if (m = line.match(/\A(.+?)\s*(#{arrow})\s*(.+?)\s*;?\z/))
        return [m[1], m[3], '', m[2]]
      end

      nil
    end

    def parse!
      lines = @source.lines.map(&:rstrip)

      first =
        lines.index { |line| !line.strip.empty? }

      raise ArgumentError, 'flowchart/graph がありません。' unless first

      header =
        lines[first].strip.match(
          /\A(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i
        )

      raise ArgumentError, 'flowchart TD/LR形式ではありません。' unless header

      @direction =
        header[1].upcase == 'TB' ? 'TD' : header[1].upcase

      i = first + 1

      while i < lines.length
        line = lines[i].strip
        i += 1

        next if line.empty? || line.start_with?('%%')
        next if line.match?(/\A(?:classDef|class|style|linkStyle|click|subgraph|end)\b/i)

        # 複数行ノード定義を結合
        unless parse_edge(line)
          joined = line

          while joined.count('[') > joined.count(']') ||
                joined.count('{') > joined.count('}') ||
                joined.count('(') > joined.count(')') ||
                joined.count('"').odd?

            break if i >= lines.length

            joined += '<br/>' + lines[i].strip
            i += 1
          end

          line = joined
        end

        if (edge = parse_edge(line))
          left = ensure_node(parse_node_token(edge[0]))
          right = ensure_node(parse_node_token(edge[1]))

          if left && right
            @edges << Edge.new(
              from: left.id,
              to: right.id,
              label: edge[2],
              arrow: edge[3]
            )
          end

          next
        end

        ensure_node(parse_node_token(line))
      end

      raise ArgumentError, 'フローチャートのノードがありません。' if @nodes.empty?
    end

    def estimate(text, size = 14)
      units =
        text.to_s.each_char.sum do |ch|
          ch.ord > 0x2ff ? 1.0 : 0.58
        end

      [30, units * size].max
    end

    def metrics(node)
      lines = split_lines(node.label)
      lines = [node.id] if lines.empty?

      text_width =
        lines.map { |line| estimate(line, 14) }.max || 70

      width =
        [[text_width + 42, 120].max, 300].min

      height =
        [54, 26 + lines.length * 19].max

      height = [height, 90].max if node.shape == :diamond

      {
        lines: lines,
        width: width,
        height: height
      }
    end

    def compute_ranks
      incoming =
        @nodes.keys.to_h { |id| [id, 0] }

      outgoing =
        @nodes.keys.to_h { |id| [id, []] }

      @edges.each do |edge|
        next unless outgoing.key?(edge.from) &&
                    incoming.key?(edge.to)

        outgoing[edge.from] << edge.to
        incoming[edge.to] += 1
      end

      queue =
        incoming.select { |_id, count| count.zero? }.keys

      rank =
        @nodes.keys.to_h { |id| [id, 0] }

      until queue.empty?
        id = queue.shift

        outgoing[id].each do |to|
          rank[to] =
            [rank[to], rank[id] + 1].max

          incoming[to] -= 1
          queue << to if incoming[to].zero?
        end
      end

      rank
    end

    def text_element(x, y, lines, size: 14, weight: 400)
      tspans =
        lines.each_with_index.map do |line, index|
          dy = index.zero? ? 0 : 19

          %(<tspan x="#{x.round(1)}" dy="#{dy}">#{h(line)}</tspan>)
        end.join

      %(<text x="#{x.round(1)}" y="#{y.round(1)}" text-anchor="middle" font-size="#{size}" font-family="Arial, sans-serif" font-weight="#{weight}" fill="#24292f">#{tspans}</text>)
    end

    def layout_and_render
      rank = compute_ranks

      groups =
        @nodes.keys.group_by { |id| rank[id] || 0 }

      ranks = groups.keys.sort

      vertical =
        %w[TD BT].include?(@direction)

      rank_gap = vertical ? 170 : 220
      node_gap = 70
      margin = 70

      node_metrics =
        @nodes.transform_values { |node| metrics(node) }

      positions = {}

      max_cross =
        groups.values.map do |ids|
          ids.sum do |id|
            m = node_metrics[id]
            vertical ? m[:width] : m[:height]
          end + [ids.length - 1, 0].max * node_gap
        end.max || 500

      ranks.each_with_index do |r, rank_index|
        ids = groups[r]

        total =
          ids.sum do |id|
            m = node_metrics[id]
            vertical ? m[:width] : m[:height]
          end + [ids.length - 1, 0].max * node_gap

        cursor =
          margin + (max_cross - total) / 2.0

        ids.each do |id|
          m = node_metrics[id]

          if vertical
            positions[id] = {
              x: cursor + m[:width] / 2.0,
              y: margin + rank_index * rank_gap + m[:height] / 2.0
            }

            cursor += m[:width] + node_gap
          else
            positions[id] = {
              x: margin + rank_index * rank_gap + m[:width] / 2.0,
              y: cursor + m[:height] / 2.0
            }

            cursor += m[:height] + node_gap
          end
        end
      end

      width = 720
      height = 420

      positions.each do |id, pos|
        m = node_metrics[id]

        width =
          [width, pos[:x] + m[:width] / 2.0 + margin].max

        height =
          [height, pos[:y] + m[:height] / 2.0 + margin].max
      end

      out = []

      out << %(<svg xmlns="http://www.w3.org/2000/svg" width="#{width.ceil}" height="#{height.ceil}" viewBox="0 0 #{width.ceil} #{height.ceil}">)

      out << '<rect width="100%" height="100%" fill="#ffffff"/>'

      out << '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#344054"/></marker></defs>'

      @edges.each do |edge|
        a = positions[edge.from]
        b = positions[edge.to]

        next unless a && b

        ma = node_metrics[edge.from]
        mb = node_metrics[edge.to]

        if vertical
          x1 = a[:x]
          y1 = a[:y] + ma[:height] / 2.0
          x2 = b[:x]
          y2 = b[:y] - mb[:height] / 2.0

          mid = (y1 + y2) / 2.0
          d = "M#{x1},#{y1} V#{mid} H#{x2} V#{y2}"
        else
          x1 = a[:x] + ma[:width] / 2.0
          y1 = a[:y]
          x2 = b[:x] - mb[:width] / 2.0
          y2 = b[:y]

          mid = (x1 + x2) / 2.0
          d = "M#{x1},#{y1} H#{mid} V#{y2} H#{x2}"
        end

        dash =
          edge.arrow == '-.->' ? ' stroke-dasharray="6 4"' : ''

        marker =
          edge.arrow == '---' ? '' : ' marker-end="url(#arrow)"'

        out << %(<path d="#{d}" fill="none" stroke="#344054" stroke-width="1.5"#{dash}#{marker}/>)

        unless edge.label.to_s.empty?
          lx = (x1 + x2) / 2.0
          ly = (y1 + y2) / 2.0 - 8

          out << text_element(
            lx,
            ly,
            [edge.label],
            size: 12,
            weight: 600
          )
        end
      end

      @nodes.each do |id, node|
        pos = positions[id]
        m = node_metrics[id]

        x = pos[:x] - m[:width] / 2.0
        y = pos[:y] - m[:height] / 2.0

        case node.shape
        when :diamond
          points = [
            "#{pos[:x]},#{y}",
            "#{x + m[:width]},#{pos[:y]}",
            "#{pos[:x]},#{y + m[:height]}",
            "#{x},#{pos[:y]}"
          ].join(' ')

          out << %(<polygon points="#{points}" fill="#f8fafc" stroke="#667085" stroke-width="1.4"/>)

        when :circle
          radius = [m[:width], m[:height]].max / 2.0

          out << %(<circle cx="#{pos[:x]}" cy="#{pos[:y]}" r="#{radius}" fill="#f8fafc" stroke="#667085" stroke-width="1.4"/>)

        when :round, :stadium
          radius =
            node.shape == :stadium ? m[:height] / 2.0 : 12

          out << %(<rect x="#{x}" y="#{y}" width="#{m[:width]}" height="#{m[:height]}" rx="#{radius}" fill="#f8fafc" stroke="#667085" stroke-width="1.4"/>)

        else
          out << %(<rect x="#{x}" y="#{y}" width="#{m[:width]}" height="#{m[:height]}" rx="4" fill="#f8fafc" stroke="#667085" stroke-width="1.4"/>)
        end

        text_y =
          pos[:y] - ((m[:lines].length - 1) * 19) / 2.0 + 5

        out << text_element(
          pos[:x],
          text_y,
          m[:lines],
          size: 14,
          weight: 600
        )
      end

      out << '</svg>'
      out.join
    end
  end
end