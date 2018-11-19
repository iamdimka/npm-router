const regx = /\/:(\w+)(\([^)]+\))?(\?)?(\.\.\.)?/g

export default function compile(checkPath: string): (path: string, vars: { [key: string]: string | any }) => boolean {
  let data = regx.exec(checkPath)
  if (data) {
    let i = 0
    let regExp = ""
    const names: string[] = []

    while (data) {
      const [match, name, rx = "([^/]+)", optional, rest] = data
      regExp += regexpEscape(checkPath.substring(i, data.index))
      i = data.index + match.length
      names.push(name)
      if (rest) {
        var r = rx.replace(/(^|[^\\])\((?!\?:)/g, "$1(?:")
        regExp += `(?:/(${r}(?:\/${r})*))${optional ? "?" : ""}`
      } else {
        regExp += optional ? `(?:/${rx})?` : `/${rx}`
      }
      data = regx.exec(checkPath)
    }

    regExp += regexpEscape(checkPath.substring(i))

    const rx = new RegExp(`^${regExp}$`)
    const { length } = names
    return (path, vars) => {
      const match = path.match(rx)
      if (match) {
        for (let i = 0; i < length; i++)
          vars[names[i]] = match[i + 1]

        return true
      }

      return false
    }
  }

  if (checkPath.endsWith("...")) {
    checkPath = checkPath.slice(0, -3)
    const check = checkPath + "/"
    return path => path === checkPath || path.indexOf(check) === 0
  }

  return path => path === checkPath
}

function regexpEscape(str: string) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1")
}