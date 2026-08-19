# frozen_string_literal: true

require 'cgi'

module RedmineProjectExplorer
  class SequenceSvgRenderer
    Participant = Struct.new(:id, :label, keyword_init: true)

    def initialize(source)
      @source = source.to_s.gsub(/\r\n?/, "\n")
      @participants = []
      @participant_map = {}
      @events = []
    end

    def render
      parse!
      layout_and_render
    end

    private

    def h(value)
      CGI.escapeHTML(value.to_s)
    end

    def ensure_participant(id, label = nil)
      participant = @participant_map[id]
      unless participant
        participant = Participant.new(id: id, label: ((label && !label.to_s.empty?) ? label : id))
        @participant_map[id] = participant
        @participants << participant
      end
      participant.label = label if label && !label.to_s.empty?
      participant
    end

    def parse!
      lines = @source.lines.map(&:rstrip)
      first = lines.index { |line| !line.strip.empty? }
      raise ArgumentError, 'sequenceDiagram で始まっていません。' unless first && lines[first].strip == 'sequenceDiagram'

      stack = []
      lines[(first + 1)..].to_a.each do |raw|
        line = raw.strip
        next if line.empty? || line.start_with?('%%')

        if (m = line.match(/^(?:participant|actor)\s+([A-Za-z0-9_.-]+)(?:\s+as\s+(.+))?$/i))
          ensure_participant(m[1], (m[2] || m[1]).strip)
        elsif (m = line.match(/^Note\s+(over|right of|left of)\s+([A-Za-z0-9_.-]+)(?:\s*,\s*([A-Za-z0-9_.-]+))?\s*:\s*(.+)$/i))
          ensure_participant(m[2]); ensure_participant(m[3]) if m[3]
          @events << {type: :note, placement: m[1].downcase, from: m[2], to: (m[3] || m[2]), text: m[4]}
        elsif (m = line.match(/^([A-Za-z0-9_.-]+?)\s*(-->>|->>|-->|->)\s*([A-Za-z0-9_.-]+)\s*:\s*(.+)$/))
          ensure_participant(m[1]); ensure_participant(m[3])
          @events << {type: :message, from: m[1], to: m[3], arrow: m[2], text: m[4]}
        elsif (m = line.match(/^(alt|opt|loop|par|critical|break)\s*(.*)$/i))
          stack << m[1].downcase
          @events << {type: :fragment_start, kind: m[1].downcase, label: m[2].to_s.strip}
        elsif (m = line.match(/^(else|and)\s*(.*)$/i)) && stack.any?
          @events << {type: :fragment_else, kind: stack.last, label: m[2].to_s.strip}
        elsif line.match?(/^end$/i) && stack.any?
          @events << {type: :fragment_end, kind: stack.pop}
        else
          @events << {type: :raw, text: line}
        end
      end
      raise ArgumentError, 'participant を確認できません。' if @participants.empty?
    end

    def markup_lines(text)
      text.to_s.split(/<br\s*\/?\s*>/i).map(&:strip)
    end

    def estimate(text, size = 13)
      units = text.to_s.each_char.sum { |ch| ch.ord > 0x2ff ? 1.0 : 0.58 }
      [30, units * size].max
    end

    def text_element(x, y, lines, size: 13, anchor: 'middle', weight: 400, fill: '#24292f')
      tspans = lines.each_with_index.map do |line, i|
        dy = i.zero? ? 0 : (size * 1.35).round
        %(<tspan x="#{x.round(1)}" dy="#{dy}">#{h(line)}</tspan>)
      end.join
      %(<text x="#{x.round(1)}" y="#{y.round(1)}" text-anchor="#{anchor}" font-size="#{size}" font-family="Arial, sans-serif" font-weight="#{weight}" fill="#{fill}">#{tspans}</text>)
    end

    def layout_and_render
      count = @participants.size
      spacing = [[1240.0 / [count - 1, 1].max, 245].min, 190].max
      box_w = [175, spacing - 20].min
      margin = [[112, (box_w / 2.0 + 24).ceil].max, 160].min
      top = 20
      box_h = 48
      event_y = 105
      x = {}
      @participants.each_with_index { |p, i| x[p.id] = margin + i * spacing }
      width = [720, margin * 2 + (count - 1) * spacing].max

      laid = []
      fragments = []
      frag_stack = []
      y = event_y
      @events.each do |ev|
        case ev[:type]
        when :message
          hgt = ev[:from] == ev[:to] ? 66 : 52
          laid << ev.merge(y: y, h: hgt); y += hgt
        when :note
          lines = markup_lines(ev[:text]); hgt = [50, 24 + lines.size * 18].max
          laid << ev.merge(y: y, h: hgt, lines: lines); y += hgt + 8
        when :raw
          laid << ev.merge(y: y, h: 42); y += 42
        when :fragment_start
          f = {kind: ev[:kind], label: ev[:label], y1: y, separators: []}
          fragments << f; frag_stack << f; y += 38
        when :fragment_else
          if (f = frag_stack.last)
            f[:separators] << {y: y, label: ev[:label]}; y += 34
          end
        when :fragment_end
          if (f = frag_stack.pop)
            f[:y2] = y + 10; y += 22
          end
        end
      end
      fragments.each { |f| f[:y2] ||= y + 10 }
      bottom_y = y + 32
      height = bottom_y + box_h + 24
      out = []
      out << %(<svg xmlns="http://www.w3.org/2000/svg" width="#{width.round}" height="#{height.round}" viewBox="0 0 #{width.round} #{height.round}">)
      out << '<rect width="100%" height="100%" fill="#ffffff"/>'
      out << '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#344054"/></marker></defs>'

      # fragments behind messages
      left = [18, margin - box_w / 2.0 - 18].min
      right = width - left
      fragments.each do |f|
        fy1, fy2 = f[:y1], f[:y2]
        out << %(<rect x="#{left}" y="#{fy1}" width="#{right-left}" height="#{fy2-fy1}" fill="#fbfcfe" stroke="#cbd5e1"/>)
        tab_w = [62, estimate(f[:kind], 11) + 24].max
        out << %(<path d="M#{left},#{fy1} h#{tab_w} l-12,22 h-#{tab_w-12} z" fill="#eef3f8" stroke="#cbd5e1"/>)
        out << text_element(left + 8, fy1 + 15, [f[:kind]], size: 11, anchor: 'start', weight: 700)
        if f[:label] && !f[:label].to_s.empty?
          out << text_element(left + tab_w + 12, fy1 + 16, ["[#{f[:label]}]"], size: 11, anchor: 'start', weight: 700)
        end
        f[:separators].each do |sep|
          out << %(<line x1="#{left}" y1="#{sep[:y]}" x2="#{right}" y2="#{sep[:y]}" stroke="#cbd5e1" stroke-dasharray="4 3"/>)
          if sep[:label] && !sep[:label].to_s.empty?
            out << text_element(left + 8, sep[:y] + 18, ["[#{sep[:label]}]"], size: 11, anchor: 'start', weight: 700)
          end
        end
      end

      # lifelines
      @participants.each do |p|
        px = x[p.id]
        out << %(<line x1="#{px}" y1="#{top+box_h}" x2="#{px}" y2="#{bottom_y}" stroke="#c9d2dc"/>)
      end

      # events
      laid.each do |ev|
        cy = ev[:y] + 20
        case ev[:type]
        when :message
          x1, x2 = x[ev[:from]], x[ev[:to]]
          if x1 == x2
            out << %(<path d="M#{x1},#{cy} h38 v24 h-38" fill="none" stroke="#344054" stroke-width="1.5" marker-end="url(#arrow)"/>)
            out << text_element(x1 + 20, cy - 6, [ev[:text]], size: 12)
          else
            dash = ev[:arrow].start_with?('--') ? ' stroke-dasharray="6 4"' : ''
            out << %(<line x1="#{x1}" y1="#{cy}" x2="#{x2}" y2="#{cy}" stroke="#344054" stroke-width="1.5"#{dash} marker-end="url(#arrow)"/>)
            out << text_element((x1+x2)/2.0, cy - 7, [ev[:text]], size: 12)
          end
        when :note
          from_x, to_x = x[ev[:from]], x[ev[:to]]
          center = case ev[:placement]
                   when 'right of' then from_x + 70
                   when 'left of' then from_x - 70
                   else (from_x + to_x) / 2.0
                   end
          note_w = [[ev[:lines].map { |l| estimate(l, 12) }.max.to_f + 34, 120].max, 360].min
          note_h = ev[:h] - 4
          nx = [[center - note_w/2.0, 8].max, width-note_w-8].min
          out << %(<rect x="#{nx}" y="#{ev[:y]}" width="#{note_w}" height="#{note_h}" rx="4" fill="#fff3bf" stroke="#d3a514"/>)
          out << text_element(nx + note_w/2.0, ev[:y] + 20, ev[:lines], size: 12)
        when :raw
          out << text_element(width/2.0, ev[:y] + 18, [ev[:text]], size: 11, fill: '#667085')
        end
      end

      # participant boxes top and bottom
      [top, bottom_y].each do |py|
        @participants.each do |p|
          px = x[p.id] - box_w/2.0
          out << %(<rect x="#{px}" y="#{py}" width="#{box_w}" height="#{box_h}" rx="5" fill="#f5f7fa" stroke="#cbd5e1"/>)
          out << text_element(x[p.id], py + 29, [p.label], size: 12, weight: 700)
        end
      end
      out << '</svg>'
      out.join
    end
  end
end
