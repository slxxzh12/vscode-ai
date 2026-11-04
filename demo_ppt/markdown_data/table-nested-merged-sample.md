# 表格嵌套与合并单元格样例

> 仅使用 `<table>` 表格族 HTML 标签（`table` / `thead` / `tbody` / `tfoot` / `tr` / `th` / `td` / `caption` / `colgroup` / `col`）。
> Markdown 原生语法表格无法表达单元格合并与嵌套，需要合并/嵌套时请直接写原始 HTML 表格。
> 默认显示边框；加 `border="0"`（或 `class="md-borderless"`）可隐藏边框，只保留斑马纹。

## 1. 表头合并 + 行合并

<table>
  <thead>
    <tr>
      <th rowspan="2">姓名</th>
      <th colspan="2">成绩</th>
    </tr>
    <tr>
      <th>语文</th>
      <th>数学</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="2">张三</td>
      <td>90</td>
      <td>95</td>
    </tr>
    <tr>
      <td>88</td>
      <td>92</td>
    </tr>
    <tr>
      <td>李四</td>
      <td>70</td>
      <td>75</td>
    </tr>
  </tbody>
</table>

## 2. 表格内嵌表格

<table>
  <thead>
    <tr>
      <th>部门</th>
      <th>小组</th>
      <th>成员明细</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="2">研发部</td>
      <td>前端</td>
      <td>
        <table>
          <thead>
            <tr><th>姓名</th><th>职责</th></tr>
          </thead>
          <tbody>
            <tr><td>张三</td><td>组件</td></tr>
            <tr><td>李四</td><td>样式</td></tr>
          </tbody>
        </table>
      </td>
    </tr>
    <tr>
      <td>后端</td>
      <td>API</td>
    </tr>
  </tbody>
</table>

## 3. 三层嵌套

<table>
  <thead>
    <tr><th>一级</th><th>二级</th></tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="2">A</td>
      <td>
        <table>
          <thead>
            <tr><th>B</th><th>C</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>B1</td>
              <td>
                <table>
                  <thead>
                    <tr><th>D</th><th>E</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>D1</td><td>E1</td></tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
    <tr>
      <td>B2</td>
    </tr>
  </tbody>
</table>

## 4. caption + colgroup + 跨行跨列

<table>
  <caption>季度销售汇总</caption>
  <colgroup>
    <col />
    <col span="2" />
  </colgroup>
  <thead>
    <tr>
      <th rowspan="2">区域</th>
      <th colspan="2">季度</th>
    </tr>
    <tr>
      <th>Q1</th>
      <th>Q2</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="2">华东</td>
      <td>120</td>
      <td>150</td>
    </tr>
    <tr>
      <td>130</td>
      <td>160</td>
    </tr>
    <tr>
      <td>华南</td>
      <td>90</td>
      <td>110</td>
    </tr>
  </tbody>
  <tfoot>
    <tr>
      <td colspan="3">合计：760</td>
    </tr>
  </tfoot>
</table>

## 5. 无边框（border="0"）

<table border="0">
  <thead>
    <tr>
      <th rowspan="2">姓名</th>
      <th colspan="2">成绩</th>
    </tr>
    <tr>
      <th>语文</th>
      <th>数学</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="2">张三</td>
      <td>90</td>
      <td>95</td>
    </tr>
    <tr>
      <td>88</td>
      <td>92</td>
    </tr>
    <tr>
      <td>李四</td>
      <td>70</td>
      <td>75</td>
    </tr>
  </tbody>
</table>

## 6. 无边框 + 嵌套

<table border="0">
  <thead>
    <tr>
      <th>部门</th>
      <th>小组</th>
      <th>成员明细</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="2">研发部</td>
      <td>前端</td>
      <td>
        <table>
          <thead>
            <tr><th>姓名</th><th>职责</th></tr>
          </thead>
          <tbody>
            <tr><td>张三</td><td>组件</td></tr>
            <tr><td>李四</td><td>样式</td></tr>
          </tbody>
        </table>
      </td>
    </tr>
    <tr>
      <td>后端</td>
      <td>API</td>
    </tr>
  </tbody>
</table>
